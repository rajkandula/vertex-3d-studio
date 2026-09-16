/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Point3D, Shape3D } from "../../types";

/**
 * Dots in space.
 *
 * Space is a lattice of points; building an object lights up the lattice points
 * that lie on its surfaces. Models are still authored as parametric parts (see
 * engine/primitives) but are shown only as dots: faces, edges and nodes are
 * sampled and snapped to a lattice that subdivides the background field
 * (FIELD_STEP / 2^k), so a model is a finer layer of the same grid.
 *
 * Model space is z-up; three.js is y-up, so (x, y, z) is emitted as (x, z, -y).
 */

export const FIELD_STEP = 25;
const FIELD_PER_SIDE = 161; // 161³ ≈ 4.2 million background dots
const FIELD_MIN_EXTENT = FIELD_STEP * 80; // ±2000: the camera sits well inside the field
const SAMPLE_RATIO = 0.5; // sample at half the lattice step so snapped surfaces have no gaps
const MAX_DEPTH = 8; // finest lattice = FIELD_STEP / 256

/** How dense a model's dots may get (see detail.ts). */
export interface DotDensity {
  dotsPerRadius: number; // don't go finer than this many dots across the model's radius
  sampleBudget: number; // surface samples before de-duplication
}

type V = [number, number, number];
type RGB = [number, number, number];

export interface DotCloud {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
  step: number; // lattice spacing the model was sampled at
  center: V;
  radius: number;
}

/** Half-width of the background field: big enough that the camera framing `reach` stays inside it. */
export function fieldExtent(reach: number): number {
  return Math.max(FIELD_MIN_EXTENT, Math.ceil((reach * 4) / FIELD_STEP) * FIELD_STEP);
}

/**
 * Background lattice: FIELD_PER_SIDE³ dots spanning -extent..extent on every axis.
 * The dot count is fixed; a larger extent widens the spacing (in FIELD_STEP multiples).
 */
export function buildField(extent: number): Float32Array {
  const n = (FIELD_PER_SIDE - 1) / 2;
  const step = FIELD_STEP * Math.max(1, Math.ceil(extent / FIELD_STEP / n));
  const out = new Float32Array(FIELD_PER_SIDE ** 3 * 3);
  let o = 0;
  for (let i = -n; i <= n; i++) {
    const x = i * step;
    for (let j = -n; j <= n; j++) {
      const y = j * step;
      for (let k = -n; k <= n; k++) {
        out[o++] = x;
        out[o++] = y;
        out[o++] = k * step;
      }
    }
  }
  return out;
}

export const toScene = (n: Point3D): V => [n.x, n.z, -n.y];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: V) => Math.hypot(v[0], v[1], v[2]);

const colorCache = new Map<string, RGB>();
export function toRGB(hex: string | undefined): RGB {
  const key = hex || "";
  const cached = colorCache.get(key);
  if (cached) return cached;
  let digits = /^#?([0-9a-f]{6})$/i.exec(key)?.[1];
  const short = /^#?([0-9a-f]{3})$/i.exec(key)?.[1];
  if (!digits && short) digits = short.split("").map((ch) => ch + ch).join("");
  const n = digits ? parseInt(digits, 16) : 0x7dd3fc;
  // Lift toward white so dark part colours (tyres, trim) still read against black space,
  // then convert sRGB -> linear, which is what three.js expects for vertex colours.
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = (v / 255) * 0.75 + 0.25;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as RGB;
  colorCache.set(key, rgb);
  return rgb;
}

interface Tri { a: V; ab: V; ac: V; lab: number; lac: number; color: RGB }
interface Seg { a: V; ab: V; l: number; color: RGB }

// Anchor each triangle at the vertex opposite its longest edge: its two edges are
// the shorter pair, which keeps the sample grid small for long thin slivers.
function makeTri(p: V, q: V, r: V, color: RGB): Tri {
  const lpq = len(sub(q, p)), lqr = len(sub(r, q)), lrp = len(sub(p, r));
  let a = q, b = r, c = p;
  if (lpq >= lqr && lpq >= lrp) [a, b, c] = [r, p, q];
  else if (lqr >= lpq && lqr >= lrp) [a, b, c] = [p, q, r];
  const ab = sub(b, a), ac = sub(c, a);
  return { a, ab, ac, lab: len(ab), lac: len(ac), color };
}

function estimateSamples(tris: Tri[], segs: Seg[], h: number, budget: number): number {
  let total = 0;
  for (const t of tris) {
    total += ((Math.ceil(t.lab / h) + 1) * (Math.ceil(t.lac / h) + 1)) / 2;
    if (total > budget) return total;
  }
  for (const s of segs) total += Math.ceil(s.l / h) + 1;
  return total;
}

/** Light up the lattice dots that lie on the shape's faces, edges and nodes. */
export function shapeToDots(shape: Shape3D, { dotsPerRadius, sampleBudget }: DotDensity): DotCloud | null {
  if (!shape.nodes.length) return null;
  const byId = new Map(shape.nodes.map((n) => [n.id, n]));

  const tris: Tri[] = [];
  for (const f of shape.faces || []) {
    const pts = f.nodeIds.map((id) => byId.get(id)).filter((n): n is Point3D => !!n).map(toScene);
    const color = toRGB(f.color);
    for (let i = 1; i < pts.length - 1; i++) tris.push(makeTri(pts[0], pts[i], pts[i + 1], color));
  }
  const segs: Seg[] = [];
  for (const e of shape.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const a = toScene(s);
    const ab = sub(toScene(t), a);
    segs.push({ a, ab, l: len(ab), color: toRGB(e.color || s.color) });
  }

  const min: V = [Infinity, Infinity, Infinity];
  const max: V = [-Infinity, -Infinity, -Infinity];
  for (const n of shape.nodes) {
    const p = toScene(n);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  const center: V = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1, 0.5 * len(sub(max, min)));

  // Finest lattice (FIELD_STEP / 2^k) that respects the detail floor and the sample budget.
  let step = FIELD_STEP;
  for (let k = MAX_DEPTH; k >= 0; k--) {
    const s = FIELD_STEP / 2 ** k;
    if (s < radius / dotsPerRadius) continue;
    if (estimateSamples(tris, segs, s * SAMPLE_RATIO, sampleBudget) <= sampleBudget) {
      step = s;
      break;
    }
  }

  const h = step * SAMPLE_RATIO;
  const inv = 1 / step;
  const OFF = 65536;
  const SPAN = 131072;
  const seen = new Set<number>();
  const pos: number[] = [];
  const col: number[] = [];
  const add = (x: number, y: number, z: number, c: RGB) => {
    const i = Math.round(x * inv), j = Math.round(y * inv), k = Math.round(z * inv);
    if (Math.abs(i) >= OFF || Math.abs(j) >= OFF || Math.abs(k) >= OFF) return;
    const key = ((i + OFF) * SPAN + (j + OFF)) * SPAN + (k + OFF);
    if (seen.has(key)) return;
    seen.add(key);
    pos.push(i * step, j * step, k * step);
    col.push(c[0], c[1], c[2]);
  };

  for (const t of tris) {
    const nu = Math.max(1, Math.ceil(t.lab / h));
    const nv = Math.max(1, Math.ceil(t.lac / h));
    for (let u = 0; u <= nu; u++) {
      const fu = u / nu;
      const vmax = Math.floor((1 - fu) * nv + 1e-6);
      for (let v = 0; v <= vmax; v++) {
        const fv = v / nv;
        add(
          t.a[0] + t.ab[0] * fu + t.ac[0] * fv,
          t.a[1] + t.ab[1] * fu + t.ac[1] * fv,
          t.a[2] + t.ab[2] * fu + t.ac[2] * fv,
          t.color,
        );
      }
    }
  }
  for (const s of segs) {
    const n = Math.max(1, Math.ceil(s.l / h));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      add(s.a[0] + s.ab[0] * f, s.a[1] + s.ab[1] * f, s.a[2] + s.ab[2] * f, s.color);
    }
  }
  for (const n of shape.nodes) {
    const p = toScene(n);
    add(p[0], p[1], p[2], toRGB(n.color));
  }

  // Order dots bottom-up (counting sort on height) so the reveal builds from the ground.
  const count = pos.length / 3;
  const BINS = 512;
  const span = max[1] - min[1] || 1;
  const binOf = (y: number) => Math.max(0, Math.min(BINS - 1, Math.floor(((y - min[1]) / span) * BINS)));
  const starts = new Uint32Array(BINS + 1);
  for (let i = 0; i < count; i++) starts[binOf(pos[i * 3 + 1]) + 1]++;
  for (let b = 0; b < BINS; b++) starts[b + 1] += starts[b];
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const d = starts[binOf(pos[i * 3 + 1])]++ * 3;
    for (let k = 0; k < 3; k++) {
      positions[d + k] = pos[i * 3 + k];
      colors[d + k] = col[i * 3 + k];
    }
  }

  return { positions, colors, count, step, center, radius };
}
