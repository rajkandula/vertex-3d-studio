/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { activeChat, useStudio } from "../state/studioStore";
import { applyTweak, detectTweak, tweakParts } from "../engine/transform";
import type { BuildUsage, ChatMessage } from "../state/types";
import { editShape, generateShape, totalTokens } from "./generateClient";

// Phrasing that means "make a brand-new thing" rather than edit the current one.
const looksLikeNew = (p: string) =>
  /^(a |an |the |create |make a |make an |build |generate |design |draw |new )/i.test(p.trim()) ||
  /\b(instead|replace it with|start over|from scratch)\b/i.test(p);

const usageLabel = (u: BuildUsage) => `${totalTokens(u).toLocaleString()} tokens · ${(u.ms / 1000).toFixed(1)}s`;

/** How a prompt should be routed. "auto" = decide; "new"/"edit" = forced by the user. */
export type GenMode = "auto" | "new" | "edit";

/**
 * One entry point for the prompt bar. It records the prompt in the active chat, then
 * decides whether the instruction is a geometric tweak (applied instantly to the current
 * model), a context-aware AI edit of the current model, or a brand-new generation. The
 * caller can force the choice with `mode` ("new" / "edit") to override routing.
 */
export function useGenerate() {
  const { state, dispatch } = useStudio();

  const run = async (raw: string, mode: GenMode = "auto"): Promise<string> => {
    const text = raw.trim();
    if (!text) return "";
    const hasModel = state.shape.nodes.length > 0;
    const earlierPrompts = activeChat(state)
      .messages.filter((m) => m.role === "user")
      .map((m) => m.text)
      .slice(-10);

    dispatch({ type: "ADD_MESSAGE", message: { role: "user", text } });

    // Reply in the chat and mirror a one-line summary in the status bar.
    const reply = (message: Omit<ChatMessage, "id" | "at" | "role">, status: string) => {
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", ...message } });
      dispatch({ type: "SET_STATUS", status });
      return status;
    };
    const fail = (err: unknown): never => {
      const msg = (err as Error)?.message || "Generation failed.";
      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", text: msg, kind: "error" } });
      throw err;
    };

    // Anything except a forced "new" may tweak or edit the current model first.
    if (mode !== "new") {
      // 1) Instant geometric tweak of the current model — no AI, works on anything.
      const tweak = detectTweak(text);
      if (tweak && hasModel) {
        dispatch({
          type: "SET_SHAPE",
          shape: applyTweak(state.shape, tweak),
          parts: tweakParts(state.partsProgram, tweak),
          refit: false,
        });
        return reply({ text: `Made it ${tweak.label}.`, kind: "tweak" }, `Made it ${tweak.label} — instant, no AI tokens.`);
      }

      // 2) Context-aware AI edit of the current (AI-generated) model. In forced
      //    "edit" mode we ignore the new-thing phrasing so "a bigger car" edits.
      if (hasModel && state.partsProgram && (mode === "edit" || !looksLikeNew(text))) {
        dispatch({ type: "SET_STATUS", status: `Editing: ${text}…` });
        try {
          const { shape, parts, usage, reasoning } = await editShape(text, state.partsProgram, earlierPrompts, state.view.detail);
          dispatch({ type: "SET_SHAPE", shape, parts });
          dispatch({ type: "SET_LAST_BUILD", build: { ...usage, kind: "edit", title: shape.title, prompt: text } });
          return reply({ text: `Updated “${shape.title}”.`, kind: "edit", usage, reasoning }, `Updated — ${usageLabel(usage)}`);
        } catch (err) {
          return fail(err);
        }
      }

      // Forced "edit" but there's nothing editable — don't silently make a new model.
      if (mode === "edit") {
        const msg = hasModel
          ? "This model has no editable recipe — try a tweak like “make it taller”, or switch to New."
          : "Nothing to edit yet — switch to New to create a model first.";
        return reply({ text: msg }, msg);
      }
    }

    // 3) Generate a brand-new model (auto fall-through or forced "new").
    dispatch({ type: "SET_STATUS", status: `Generating “${text}”…` });
    try {
      const { shape, parts, usage, reasoning } = await generateShape(text, state.view.detail);
      dispatch({ type: "SET_SHAPE", shape, parts, cloudId: null });
      dispatch({ type: "SET_LAST_BUILD", build: { ...usage, kind: "new", title: shape.title, prompt: text } });
      return reply({ text: `Built “${shape.title}”.`, kind: "new", usage, reasoning }, `Built “${shape.title}” — ${usageLabel(usage)}`);
    } catch (err) {
      return fail(err);
    }
  };

  return { run, hasModel: state.shape.nodes.length > 0, canEdit: !!state.partsProgram };
}
