/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import type { Point3D, Shape3D } from "../../types";
import { toRGB, toScene } from "./dots";

/**
 * Optional overlays for the dotted model: a solid surface and a wireframe. Same
 * z-up -> y-up mapping and colours as the dots, so they line up exactly.
 */

/** Faces fan-triangulated into one merged, per-face-coloured mesh. */
export function shapeToMesh(shape: Shape3D): THREE.BufferGeometry | null {
  const byId = new Map(shape.nodes.map((n) => [n.id, n]));
  const position: number[] = [];
  const color: number[] = [];
  for (const f of shape.faces || []) {
    const pts = f.nodeIds.map((id) => byId.get(id)).filter((n): n is Point3D => !!n).map(toScene);
    const c = toRGB(f.color);
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        position.push(p[0], p[1], p[2]);
        color.push(c[0], c[1], c[2]);
      }
    }
  }
  if (!position.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  g.computeVertexNormals();
  return g;
}

/** Every edge as a line segment. */
export function shapeToEdges(shape: Shape3D): THREE.BufferGeometry | null {
  const byId = new Map(shape.nodes.map((n) => [n.id, n]));
  const position: number[] = [];
  for (const e of shape.edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    position.push(...toScene(a), ...toScene(b));
  }
  if (!position.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  return g;
}
