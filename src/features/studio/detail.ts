/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Detail levels. One setting raises everything that limits how rich a model is:
 * the part budget Claude is given (server side), how smooth curved primitives are,
 * and how dense the dots are. Part budgets must match PART_BUDGETS in server.ts.
 */
export type Detail = "normal" | "high" | "ultra";

export const DETAIL_LEVELS: Detail[] = ["normal", "high", "ultra"];

export const DETAIL: Record<
  Detail,
  { label: string; hint: string; curveScale: number; dotsPerRadius: number; sampleBudget: number }
> = {
  normal: {
    label: "Normal",
    hint: "Up to ~45 parts · fastest, fewest tokens",
    curveScale: 1,
    dotsPerRadius: 120,
    sampleBudget: 900_000,
  },
  high: {
    label: "High",
    hint: "Up to ~110 parts · smoother curves, denser dots",
    curveScale: 2,
    dotsPerRadius: 240,
    sampleBudget: 1_800_000,
  },
  ultra: {
    label: "Ultra",
    hint: "Up to ~200 parts · slowest, most tokens",
    curveScale: 3,
    dotsPerRadius: 480,
    sampleBudget: 3_600_000,
  },
};
