/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Shape3D } from "../../../types";
import type { PartsProgram } from "../engine/primitives";
import type { Detail } from "../detail";

export type { Shape3D };

export interface Snapshot {
  shape: Shape3D;
  partsProgram: PartsProgram | null; // the recipe behind an AI-generated model, for context-aware edits
}

/** What the viewport draws and how it moves (persisted per browser). */
export interface ViewSettings {
  dots: boolean; // the model as lit lattice dots
  mesh: boolean; // translucent solid surface
  meshOpacity: number;
  wireframe: boolean; // part edges
  detail: Detail; // part budget, curve smoothness and dot density
  field: boolean; // the background lattice — millions of dots, heavy
  reasoning: boolean; // expand Claude's reasoning on every reply
  autoRotate: boolean;
  rotateSpeed: number;
}

/** Token usage for one Claude call, as reported by the API. */
export interface BuildUsage {
  model: string;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens
  cacheReadTokens: number;
  cacheWriteTokens: number;
  ms: number;
}

export interface BuildStats extends BuildUsage {
  kind: "new" | "edit";
  title: string;
  prompt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  kind?: "new" | "edit" | "tweak" | "error";
  usage?: BuildUsage;
  reasoning?: string; // Claude's summarized thinking for this reply
}

/** One conversation about one model: its prompts, replies and the model it ended with. */
export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  partsProgram: PartsProgram | null;
  shape: Shape3D | null; // kept only when there is no parts program to rebuild the model from
  cloudId: string | null;
  lastBuild: BuildStats | null;
}

export interface StudioState extends Snapshot {
  chats: Chat[];
  activeChatId: string;
  cloudId: string | null; // id of the saved model this work belongs to, if any
  view: ViewSettings;
  lastBuild: BuildStats | null; // token usage of the most recent AI build or edit in this chat
  status: string | null; // transient message shown above the prompt bar
  fitRequest: number; // bump to re-frame the camera on the model
  past: Snapshot[]; // undo stack (current chat only)
  future: Snapshot[]; // redo stack (current chat only)
}
