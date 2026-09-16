/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Shape3D } from "../../../types";
import type { Part, PartsProgram } from "./primitives";

/**
 * Deterministic geometric tweaks. These let "make it bigger / taller / rotate"
 * edit the CURRENT model instantly — no LLM, works on any shape. Structural
 * edits ("add a spoiler") go to the AI. Model space is z-up.
 */

export interface Tweak {
  scale?: [number, number, number];
  rotateUpDeg?: number; // rotation about the vertical (z) axis
  label: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Recognise a geometric tweak instruction, or null if it isn't one. */
export function detectTweak(prompt: string): Tweak | null {
  const p = prompt.toLowerCase();
  if (/\b(bigger|larger|big|scale up|grow|huge|enlarge|massive)\b/.test(p)) return { scale: [1.4, 1.4, 1.4], label: "bigger" };
  if (/\b(smaller|tinier|tiny|small|scale down|shrink|reduce|mini)\b/.test(p)) return { scale: [0.7, 0.7, 0.7], label: "smaller" };
  if (/\b(taller|higher|stretch|elongate)\b/.test(p)) return { scale: [1, 1, 1.4], label: "taller" };
  if (/\b(shorter|flatter|flatten|squash|squish)\b/.test(p)) return { scale: [1, 1, 0.65], label: "shorter" };
  if (/\b(wider|fatter|broader)\b/.test(p)) return { scale: [1.4, 1.4, 1], label: "wider" };
  if (/\b(narrower|thinner|slimmer|skinnier)\b/.test(p)) return { scale: [0.7, 0.7, 1], label: "narrower" };
  if (/\b(rotate|turn|spin)\b/.test(p)) return { rotateUpDeg: 45, label: "rotated" };
  return null;
}

/** Apply a tweak to a shape, about its centroid. */
export function applyTweak(shape: Shape3D, t: Tweak): Shape3D {
  let cx = 0, cy = 0, cz = 0;
  for (const n of shape.nodes) {
    cx += n.x;
    cy += n.y;
    cz += n.z;
  }
  const k = shape.nodes.length || 1;
  cx /= k;
  cy /= k;
  cz /= k;
  const s = t.scale || [1, 1, 1];
  const rad = ((t.rotateUpDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const nodes = shape.nodes.map((n) => {
    let x = (n.x - cx) * s[0];
    let y = (n.y - cy) * s[1];
    const z = (n.z - cz) * s[2];
    if (rad) {
      const nx = x * cos - y * sin;
      const ny = x * sin + y * cos;
      x = nx;
      y = ny;
    }
    return { ...n, x: round(cx + x), y: round(cy + y), z: round(cz + z) };
  });
  return { ...shape, nodes };
}

/** Keep a parts program roughly in sync after a scale tweak (best-effort, so
 *  subsequent AI edits still build on a sensible program). Rotation drops it. */
export function tweakParts(parts: PartsProgram | null, t: Tweak): PartsProgram | null {
  if (!parts) return null;
  if (t.rotateUpDeg) return null;
  const s = t.scale || [1, 1, 1];
  const avg = (s[0] + s[1] + s[2]) / 3;
  const scaled = parts.parts.map((part): Part => {
    const out: any = { ...part };
    if (Array.isArray(part.center)) out.center = [part.center[0] * s[0], part.center[1] * s[1], part.center[2] * s[2]];
    if ("size" in part && Array.isArray((part as any).size)) {
      out.size = (part as any).size.map((v: number, i: number) => round(v * (s[i] ?? avg)));
    }
    for (const key of ["radius", "length", "tube"] as const) {
      if (key in part && typeof (part as any)[key] === "number") out[key] = round((part as any)[key] * avg);
    }
    if (part.array) out.array = { ...part.array, spacing: round(part.array.spacing * avg) };
    return out as Part;
  });
  return { ...parts, parts: scaled };
}
