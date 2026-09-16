/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The published models. Each entry points at a parts recipe in public/models/ —
 * the same JSON the studio produces, so anyone can fork, edit or load it back in.
 */
export interface GalleryItem {
  id: string;
  title: string;
  prompt: string; // the sentence that built it, or the function that computed it
  parts: number;
  unit?: string; // "parts" for AI builds, "nodes" for computed math models
  note: string;
}

export const CATALOG: GalleryItem[] = [
  {
    id: "manhattan",
    title: "Manhattan Skyline",
    prompt: "the Manhattan skyline as an architectural model",
    parts: 69,
    note: "Empire State setbacks, the Chrysler crown and One WTC tapering to its mast, over a street grid and piers.",
  },
  {
    id: "saturn-v",
    title: "Saturn V",
    prompt: "a Saturn V rocket in full engineering detail",
    parts: 88,
    note: "Five F-1 engine bells, three stages with interstage rings, the Apollo stack and the escape tower.",
  },
  {
    id: "container-ship",
    title: "Panamax Container Ship",
    prompt: "a giant Panamax container ship at sea",
    parts: 100,
    note: "Rows of stacked containers, a five-deck superstructure with bridge wings, funnel, cranes and lifeboats.",
  },
  {
    id: "airliner",
    title: "Wide-Body Airliner",
    prompt: "a large four-engine commercial airliner",
    parts: 64,
    note: "Swept wings with winglets, four engines on pylons, tail fin and stabilisers, gear down, cabin windows arrayed down the fuselage.",
  },
  {
    id: "hometree",
    title: "Colossal Hometree",
    prompt: "a colossal Avatar-style Hometree",
    parts: 90,
    note: "A spiralling trunk on buttress roots, branches in tiers, hanging vines and a wide canopy.",
  },
  {
    id: "lighthouse",
    title: "Coastal Lighthouse",
    prompt: "a lighthouse",
    parts: 55,
    note: "Tapered tower of stacked cylinders, gallery deck, lantern room, windows arrayed up the shaft.",
  },
  {
    id: "car",
    title: "Sports Car",
    prompt: "a sports car",
    parts: 37,
    note: "One wheel part mirrored four ways; raked windscreen, diffuser, rear wing.",
  },
  {
    id: "city",
    title: "Downtown City Block",
    prompt: "a downtown city block with skyscrapers",
    parts: 69,
    note: "Window grids and floor slabs built from repeated parts rather than hand-placed copies.",
  },
  {
    id: "statue",
    title: "Statue of Liberty",
    prompt: "the Statue of Liberty",
    parts: 60,
    note: "Recognisable at a glance — and blocky up close, because solid primitives can't do drapery.",
  },
  {
    id: "chair",
    title: "Ladder-Back Chair",
    prompt: "a wooden chair → add armrests",
    parts: 30,
    note: "Built in one prompt, then edited in plain language: the armrests arrived, the rest stayed put.",
  },
  {
    id: "tesseract",
    title: "Tesseract",
    prompt: "generateTesseract()",
    parts: 16,
    unit: "nodes",
    note: "A 4D hypercube projected into 3D — 16 vertices, 32 edges. Computed exactly, no AI involved.",
  },
  {
    id: "mobius",
    title: "Möbius Strip",
    prompt: "generateMobiusStrip()",
    parts: 48,
    unit: "nodes",
    note: "One surface with one edge: a half-twisted band, sampled from its parametric equation.",
  },
];

const base = import.meta.env.BASE_URL;
export const modelUrl = (id: string) => `${base}models/${id}.json`;
export const thumbUrl = (id: string) => `${base}thumbs/${id}.jpg`;
