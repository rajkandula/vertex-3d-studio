/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Edge3D, Face3D, Point3D, Shape3D } from "../../../types";

/**
 * The compositional 3D engine — the "soul logic".
 *
 * Instead of asking an LLM to hand-place hundreds of vertices (slow + brittle),
 * the model emits a small PartsProgram: an assembly of parametric primitives
 * with transforms. This module deterministically expands that program into a
 * watertight Shape3D — correct topology, perfect symmetry, in microseconds.
 *
 * Conventions (must match the generation system prompt):
 *   x = length (front<->back), y = width (left<->right), z = height (up).
 *   `axis` for cylinder/cone/plane is the primitive's main axis: "x" | "y" | "z".
 *   `mirror` reflects copies across the listed world planes (e.g. ["x","y"] -> 4 copies).
 *   `array` repeats linearly along an axis.
 */

export type Axis = "x" | "y" | "z";
export type Vec3 = [number, number, number];

interface PartCommon {
  id?: string;
  color?: string;
  opacity?: number;
  center?: Vec3;
  rotate?: Vec3; // euler degrees
  mirror?: Axis[];
  array?: { axis: Axis; count: number; spacing: number };
}

export type Part =
  | (PartCommon & { type: "box"; size: Vec3 })
  | (PartCommon & { type: "wedge"; size: Vec3 })
  | (PartCommon & { type: "plane"; size: [number, number]; axis?: Axis })
  | (PartCommon & { type: "cylinder"; radius: number; length: number; axis?: Axis; segments?: number })
  | (PartCommon & { type: "cone"; radius: number; length: number; axis?: Axis; segments?: number })
  | (PartCommon & { type: "sphere"; radius: number; segments?: number; rings?: number })
  | (PartCommon & { type: "torus"; radius: number; tube: number; segments?: number; sides?: number });

export interface PartsProgram {
  title?: string;
  description?: string;
  parts: Part[];
}

interface LocalMesh {
  verts: Vec3[];
  faces: number[][]; // each face = ordered vertex indices
}

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };
const DEG = Math.PI / 180;
const PALETTE = ["#38bdf8", "#a855f7", "#f472b6", "#22d3ee", "#fbbf24", "#34d399", "#fb7185", "#818cf8"];

// ---- primitive meshes (centered at origin, in local space) ----

function boxMesh(size: Vec3): LocalMesh {
  const [sx, sy, sz] = size.map((s) => s / 2) as Vec3;
  const verts: Vec3[] = [
    [-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz],
    [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz],
  ];
  const faces = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
  ];
  return { verts, faces };
}

// Triangular prism: footprint sx*sy, ramp rising along +x to height sz.
function wedgeMesh(size: Vec3): LocalMesh {
  const [sx, sy, sz] = size.map((s) => s / 2) as Vec3;
  const verts: Vec3[] = [
    [-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz], // front triangle (y-)
    [-sx, sy, -sz], [sx, sy, -sz], [sx, sy, sz], // back triangle (y+)
  ];
  const faces = [
    [0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [0, 2, 5, 3],
  ];
  return { verts, faces };
}

function planeMesh(size: [number, number], axis: Axis): LocalMesh {
  const [a, b] = [size[0] / 2, size[1] / 2];
  let verts: Vec3[];
  if (axis === "z") verts = [[-a, -b, 0], [a, -b, 0], [a, b, 0], [-a, b, 0]];
  else if (axis === "y") verts = [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b]];
  else verts = [[0, -a, -b], [0, a, -b], [0, a, b], [0, -a, b]];
  return { verts, faces: [[0, 1, 2, 3]] };
}

function ringPoint(angle: number, r: number, axis: Axis, along: number): Vec3 {
  const c = Math.cos(angle) * r;
  const s = Math.sin(angle) * r;
  if (axis === "z") return [c, s, along];
  if (axis === "y") return [c, along, s];
  return [along, c, s];
}

function cylinderMesh(radius: number, length: number, axis: Axis, seg: number): LocalMesh {
  const h = length / 2;
  const verts: Vec3[] = [];
  for (let i = 0; i < seg; i++) verts.push(ringPoint((i / seg) * Math.PI * 2, radius, axis, -h));
  for (let i = 0; i < seg; i++) verts.push(ringPoint((i / seg) * Math.PI * 2, radius, axis, h));
  const faces: number[][] = [];
  for (let i = 0; i < seg; i++) {
    const n = (i + 1) % seg;
    faces.push([i, n, seg + n, seg + i]);
  }
  faces.push([...Array(seg).keys()]); // bottom cap
  faces.push([...Array(seg).keys()].map((i) => seg + i).reverse()); // top cap
  return { verts, faces };
}

function coneMesh(radius: number, length: number, axis: Axis, seg: number): LocalMesh {
  const h = length / 2;
  const verts: Vec3[] = [];
  for (let i = 0; i < seg; i++) verts.push(ringPoint((i / seg) * Math.PI * 2, radius, axis, -h));
  const apexIdx = verts.length;
  verts.push(ringPoint(0, 0, axis, h)); // apex on axis
  const faces: number[][] = [];
  for (let i = 0; i < seg; i++) faces.push([i, (i + 1) % seg, apexIdx]);
  faces.push([...Array(seg).keys()]); // base
  return { verts, faces };
}

function sphereMesh(radius: number, seg: number, rings: number): LocalMesh {
  const verts: Vec3[] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI; // 0..pi
    for (let j = 0; j < seg; j++) {
      const theta = (j / seg) * Math.PI * 2;
      verts.push([
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      ]);
    }
  }
  const faces: number[][] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const n = (j + 1) % seg;
      faces.push([i * seg + j, i * seg + n, (i + 1) * seg + n, (i + 1) * seg + j]);
    }
  }
  return { verts, faces };
}

function torusMesh(radius: number, tube: number, seg: number, sides: number): LocalMesh {
  const verts: Vec3[] = [];
  for (let i = 0; i < seg; i++) {
    const u = (i / seg) * Math.PI * 2;
    for (let j = 0; j < sides; j++) {
      const v = (j / sides) * Math.PI * 2;
      const r = radius + tube * Math.cos(v);
      verts.push([r * Math.cos(u), r * Math.sin(u), tube * Math.sin(v)]);
    }
  }
  const faces: number[][] = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < sides; j++) {
      const ni = (i + 1) % seg;
      const nj = (j + 1) % sides;
      faces.push([i * sides + j, ni * sides + j, ni * sides + nj, i * sides + nj]);
    }
  }
  return { verts, faces };
}

// ---- transforms ----

function rotateEuler(v: Vec3, rot: Vec3): Vec3 {
  let [x, y, z] = v;
  const [rx, ry, rz] = rot.map((d) => d * DEG);
  // X
  let cy = Math.cos(rx), sy = Math.sin(rx);
  [y, z] = [y * cy - z * sy, y * sy + z * cy];
  // Y
  cy = Math.cos(ry); sy = Math.sin(ry);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  // Z
  cy = Math.cos(rz); sy = Math.sin(rz);
  [x, y] = [x * cy - y * sy, x * sy + y * cy];
  return [x, y, z];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function negateAxis(v: Vec3, axis: Axis): Vec3 {
  const out: Vec3 = [...v];
  out[AXIS_INDEX[axis]] = -out[AXIS_INDEX[axis]];
  return out;
}

function buildLocal(part: Part, curveScale: number): LocalMesh {
  const seg = (v: number | undefined, d: number) => clampSeg(v, d, curveScale);
  switch (part.type) {
    case "box": return boxMesh(part.size);
    case "wedge": return wedgeMesh(part.size);
    case "plane": return planeMesh(part.size, part.axis ?? "z");
    case "cylinder": return cylinderMesh(part.radius, part.length, part.axis ?? "z", seg(part.segments, 16));
    case "cone": return coneMesh(part.radius, part.length, part.axis ?? "z", seg(part.segments, 16));
    case "sphere": return sphereMesh(part.radius, seg(part.segments, 12), seg(part.rings, 8));
    case "torus": return torusMesh(part.radius, part.tube, seg(part.segments, 16), seg(part.sides, 8));
    default: return boxMesh([20, 20, 20]);
  }
}

// Curve resolution; `scale` > 1 multiplies it (and its ceiling) for smoother detail levels.
const clampSeg = (v: number | undefined, d: number, scale: number) =>
  Math.max(3, Math.min(48 * scale, Math.round((v ?? d) * scale)));

/** Expand a parts program into a watertight Shape3D. Never throws on a bad part. */
export function expandProgram(program: PartsProgram, { curveScale = 1 }: { curveScale?: number } = {}): Shape3D {
  const nodes: Point3D[] = [];
  const edges: Edge3D[] = [];
  const faces: Face3D[] = [];
  const edgeSet = new Set<string>();

  (program.parts || []).forEach((part, pi) => {
    let local: LocalMesh;
    try {
      local = buildLocal(part, curveScale);
    } catch {
      return;
    }
    const color = part.color || PALETTE[pi % PALETTE.length];
    const opacity = clampOpacity(part.opacity);
    const center = part.center || [0, 0, 0];

    // place: rotate (local) -> translate to center
    let placed = local.verts.map((v) => add(part.rotate ? rotateEuler(v, part.rotate) : v, center));

    // array copies
    let copies: Vec3[][] = [placed];
    if (part.array && part.array.count > 1) {
      const out: Vec3[][] = [];
      const off: Vec3 = [0, 0, 0];
      for (let k = 0; k < part.array.count; k++) {
        const d: Vec3 = [...off];
        d[AXIS_INDEX[part.array.axis]] = k * part.array.spacing;
        out.push(placed.map((v) => add(v, d)));
      }
      copies = out;
    }

    // mirror combos (each listed axis doubles the set)
    if (part.mirror?.length) {
      for (const axis of part.mirror) {
        copies = copies.flatMap((c) => [c, c.map((v) => negateAxis(v, axis))]);
      }
    }

    copies.forEach((verts, ci) => {
      const base = nodes.length;
      verts.forEach((v, vi) => {
        nodes.push({
          id: `p${pi}_${ci}_${vi}`,
          x: round(v[0]),
          y: round(v[1]),
          z: round(v[2]),
          color,
          label: part.id,
        });
      });
      local.faces.forEach((f, fi) => {
        const nodeIds = f.map((idx) => `p${pi}_${ci}_${idx}`);
        faces.push({ id: `f${pi}_${ci}_${fi}`, nodeIds, color, opacity });
        // derive unique edges from the face perimeter
        for (let i = 0; i < f.length; i++) {
          const a = base + f[i];
          const b = base + f[(i + 1) % f.length];
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ id: `e${edges.length}`, source: nodes[a].id, target: nodes[b].id, color });
          }
        }
      });
    });
  });

  return {
    title: program.title || "Generated structure",
    description: program.description || "",
    nodes,
    edges,
    faces,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const clampOpacity = (o: number | undefined) => (typeof o === "number" ? Math.max(0.05, Math.min(0.85, o)) : 0.3);
