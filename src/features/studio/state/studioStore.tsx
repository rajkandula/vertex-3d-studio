/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { Shape3D } from "../../../types";
import { expandProgram, type PartsProgram } from "../engine/primitives";
import type { BuildStats, Chat, ChatMessage, Snapshot, StudioState, ViewSettings } from "./types";
import { DETAIL, type Detail } from "../detail";

const CHATS_KEY = "vertex.chats.v1";
const LEGACY_KEY = "vertex.space.v1"; // single-model autosave from before chats existed
const VIEW_KEY = "vertex.view.v1";
const MAX_HISTORY = 60;
const NEW_CHAT_TITLE = "New chat";

const EMPTY_SHAPE: Shape3D = { title: "", description: "", nodes: [], edges: [], faces: [] };

const DEFAULT_VIEW: ViewSettings = {
  dots: true,
  mesh: false,
  meshOpacity: 0.45,
  wireframe: false,
  detail: "normal",
  field: false,
  reasoning: false,
  autoRotate: false,
  rotateSpeed: 2,
};

function readJson(key: string): any {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // ignore corrupt or unavailable storage
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

const now = () => new Date().toISOString();

interface ChatSeed {
  title: string;
  shape: Shape3D;
  partsProgram: PartsProgram | null;
  cloudId: string | null;
}

function newChat(seed?: ChatSeed): Chat {
  const at = now();
  return {
    id: crypto.randomUUID(),
    title: seed?.title || NEW_CHAT_TITLE,
    createdAt: at,
    updatedAt: at,
    messages: [],
    partsProgram: seed?.partsProgram ?? null,
    shape: seed && !seed.partsProgram ? seed.shape : null,
    cloudId: seed?.cloudId ?? null,
    lastBuild: null,
  };
}

/** The model a chat reopens with: rebuilt from its parts recipe when it has one. */
const chatShape = (chat: Chat, detail: Detail): Shape3D =>
  chat.partsProgram
    ? expandProgram(chat.partsProgram, { curveScale: DETAIL[detail].curveScale })
    : (chat.shape ?? EMPTY_SHAPE);

function loadChats(): { chats: Chat[]; activeChatId: string } {
  const saved = readJson(CHATS_KEY);
  if (Array.isArray(saved?.chats) && saved.chats.length) {
    const hasActive = saved.chats.some((c: Chat) => c.id === saved.activeChatId);
    return { chats: saved.chats, activeChatId: hasActive ? saved.activeChatId : saved.chats[0].id };
  }
  // First run with chats: carry the previously autosaved model over as a chat.
  const legacy = readJson(LEGACY_KEY);
  const chat = legacy?.shape?.nodes?.length
    ? {
        ...newChat({
          title: legacy.shape.title || "Untitled",
          shape: legacy.shape,
          partsProgram: legacy.partsProgram ?? null,
          cloudId: legacy.cloudId ?? null,
        }),
        lastBuild: legacy.lastBuild ?? null,
      }
    : newChat();
  return { chats: [chat], activeChatId: chat.id };
}

/** Switch the working model, undo history and stats over to `chat`. */
function openChat(state: StudioState, chat: Chat, shape = chatShape(chat, state.view.detail)): StudioState {
  return {
    ...state,
    activeChatId: chat.id,
    shape,
    partsProgram: chat.partsProgram,
    cloudId: chat.cloudId,
    lastBuild: chat.lastBuild,
    past: [],
    future: [],
    status: null,
    fitRequest: state.fitRequest + 1,
  };
}

/** Chats minus the current one if it was never used (no prompts, no model), so leaving it doesn't litter the list. */
const withoutUnusedActive = (state: StudioState): Chat[] =>
  state.chats.filter(
    (c) => c.id !== state.activeChatId || c.messages.length > 0 || state.shape.nodes.length > 0,
  );

export const activeChat = (state: StudioState): Chat =>
  state.chats.find((c) => c.id === state.activeChatId) ?? state.chats[0];

export type StudioAction =
  // cloudId: omit to keep the current link, null for a brand-new (unsaved) model
  | { type: "SET_SHAPE"; shape: Shape3D; parts?: PartsProgram | null; refit?: boolean; cloudId?: string | null }
  | { type: "SET_CLOUD_ID"; id: string | null }
  | { type: "SET_VIEW"; patch: Partial<ViewSettings> }
  | { type: "SET_LAST_BUILD"; build: BuildStats }
  | { type: "SET_STATUS"; status: string | null }
  | { type: "ADD_MESSAGE"; message: Omit<ChatMessage, "id" | "at"> }
  | { type: "NEW_CHAT"; seed?: ChatSeed }
  | { type: "OPEN_CHAT"; id: string }
  | { type: "DELETE_CHAT"; id: string }
  | { type: "REFIT" }
  | { type: "UNDO" }
  | { type: "REDO" };

const snap = (s: StudioState): Snapshot => ({ shape: s.shape, partsProgram: s.partsProgram });

function reducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "SET_SHAPE":
      return {
        ...state,
        shape: action.shape,
        partsProgram: action.parts ?? null,
        cloudId: action.cloudId === undefined ? state.cloudId : action.cloudId,
        fitRequest: action.refit === false ? state.fitRequest : state.fitRequest + 1,
        past: [...state.past, snap(state)].slice(-MAX_HISTORY),
        future: [],
      };
    case "SET_CLOUD_ID":
      return { ...state, cloudId: action.id };
    case "SET_VIEW": {
      const view = { ...state.view, ...action.patch };
      // A new detail level re-smooths the current model from its recipe (not an undoable edit).
      if (view.detail !== state.view.detail && state.partsProgram) {
        const shape = expandProgram(state.partsProgram, { curveScale: DETAIL[view.detail].curveScale });
        return { ...state, view, shape };
      }
      return { ...state, view };
    }
    case "SET_LAST_BUILD":
      return { ...state, lastBuild: action.build };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "ADD_MESSAGE": {
      const message: ChatMessage = { ...action.message, id: crypto.randomUUID(), at: now() };
      return {
        ...state,
        chats: state.chats.map((c) =>
          c.id !== state.activeChatId
            ? c
            : {
                ...c,
                messages: [...c.messages, message],
                updatedAt: message.at,
                title: c.title === NEW_CHAT_TITLE && message.role === "user" ? message.text.slice(0, 60) : c.title,
              },
        ),
      };
    }
    case "NEW_CHAT": {
      const current = activeChat(state);
      // Don't pile up empty chats: "New chat" on an untouched chat just stays there.
      if (!action.seed && !current.messages.length && !state.shape.nodes.length) return state;
      const chat = newChat(action.seed);
      return openChat({ ...state, chats: [chat, ...withoutUnusedActive(state)] }, chat, action.seed?.shape);
    }
    case "OPEN_CHAT": {
      const chat = state.chats.find((c) => c.id === action.id);
      if (!chat || chat.id === state.activeChatId) return state;
      return openChat({ ...state, chats: withoutUnusedActive(state) }, chat);
    }
    case "DELETE_CHAT": {
      const chats = state.chats.filter((c) => c.id !== action.id);
      if (!chats.length) {
        const chat = newChat();
        return openChat({ ...state, chats: [chat] }, chat);
      }
      if (action.id !== state.activeChatId) return { ...state, chats };
      const latest = chats.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
      return openChat({ ...state, chats }, latest);
    }
    case "REFIT":
      return { ...state, fitRequest: state.fitRequest + 1 };
    case "UNDO": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return { ...state, status: "Nothing to undo" };
      return {
        ...state,
        ...prev,
        past: state.past.slice(0, -1),
        future: [snap(state), ...state.future].slice(0, MAX_HISTORY),
        fitRequest: state.fitRequest + 1,
        status: "Undid last change",
      };
    }
    case "REDO": {
      const next = state.future[0];
      if (!next) return { ...state, status: "Nothing to redo" };
      return {
        ...state,
        ...next,
        past: [...state.past, snap(state)].slice(-MAX_HISTORY),
        future: state.future.slice(1),
        fitRequest: state.fitRequest + 1,
        status: "Redid change",
      };
    }
    default:
      return state;
  }
}

const CHAT_NAVIGATION = new Set<StudioAction["type"]>(["NEW_CHAT", "OPEN_CHAT", "DELETE_CHAT"]);

/** Keep the active chat's stored model, link and stats in step with the working model. */
function withChatSync(base: typeof reducer) {
  return (state: StudioState, action: StudioAction): StudioState => {
    const next = base(state, action);
    if (CHAT_NAVIGATION.has(action.type)) return next;
    const changed =
      next.shape !== state.shape ||
      next.partsProgram !== state.partsProgram ||
      next.cloudId !== state.cloudId ||
      next.lastBuild !== state.lastBuild;
    if (!changed) return next;
    return {
      ...next,
      chats: next.chats.map((c) =>
        c.id !== next.activeChatId
          ? c
          : {
              ...c,
              partsProgram: next.partsProgram,
              shape: next.partsProgram || !next.shape.nodes.length ? null : next.shape,
              cloudId: next.cloudId,
              lastBuild: next.lastBuild,
              title: c.title === NEW_CHAT_TITLE && next.shape.title ? next.shape.title : c.title,
              updatedAt: now(),
            },
      ),
    };
  };
}

const studioReducer = withChatSync(reducer);

function init(): StudioState {
  const { chats, activeChatId } = loadChats();
  const base: StudioState = {
    chats,
    activeChatId,
    shape: EMPTY_SHAPE,
    partsProgram: null,
    cloudId: null,
    lastBuild: null,
    view: { ...DEFAULT_VIEW, ...(readJson(VIEW_KEY) || {}) },
    status: null,
    fitRequest: 0,
    past: [],
    future: [],
  };
  return openChat(base, activeChat(base));
}

const StudioCtx = createContext<{
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
} | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(studioReducer, undefined, init);

  // Debounced autosave of every chat (prompts, replies and each chat's model).
  useEffect(() => {
    const t = setTimeout(() => writeJson(CHATS_KEY, { activeChatId: state.activeChatId, chats: state.chats }), 500);
    return () => clearTimeout(t);
  }, [state.chats, state.activeChatId]);

  useEffect(() => writeJson(VIEW_KEY, state.view), [state.view]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioCtx);
  if (!ctx) throw new Error("useStudio must be used within <StudioProvider>");
  return ctx;
}
