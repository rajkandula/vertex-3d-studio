/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Shape3D } from "../../../types";
import { expandProgram, type PartsProgram } from "../engine/primitives";
import { DETAIL, type Detail } from "../detail";
import type { BuildUsage } from "../state/types";

export interface GenResult {
  shape: Shape3D;
  parts: PartsProgram;
  usage: BuildUsage;
  reasoning: string; // Claude's summarized thinking ("" if none came back)
}

/** Every token the call consumed: fresh input, cache reads and writes, and output (thinking included). */
export const totalTokens = (u: BuildUsage) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens;

/** Call the server generator (Claude) and expand the returned parts program into a Shape3D. */
async function requestParts(body: Record<string, unknown>, detail: Detail, emptyMessage: string): Promise<GenResult> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ...body, detail }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Generation failed (${res.status}).`);
  }
  const { data, usage, reasoning } = await res.json();
  const parts = data as PartsProgram;
  const shape = expandProgram(parts, { curveScale: DETAIL[detail].curveScale });
  if (!shape.nodes?.length) throw new Error(emptyMessage);
  return { shape, parts, usage, reasoning: typeof reasoning === "string" ? reasoning : "" };
}

/** Generate a brand-new model from a description. */
export const generateShape = (prompt: string, detail: Detail) =>
  requestParts({ prompt }, detail, "The AI returned an empty model. Try rephrasing the prompt.");

/** Ask the AI to modify the current model (given its parts program and the chat's earlier prompts). */
export const editShape = (prompt: string, current: PartsProgram, history: string[], detail: Detail) =>
  requestParts({ prompt, mode: "edit", current, history }, detail, "The edit returned an empty model. Try rephrasing.");
