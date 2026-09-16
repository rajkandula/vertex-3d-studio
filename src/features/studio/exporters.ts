/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { Point3D, Shape3D } from "../../types";
import type { PartsProgram } from "./engine/primitives";

export type ExportFormat = "glb" | "stl" | "obj" | "json";

export const EXPORT_FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "glb", label: "GLB", hint: "Blender, Unity, three.js, web — keeps colours" },
  { id: "stl", label: "STL", hint: "3D printing slicers" },
  { id: "obj", label: "OBJ", hint: "Most 3D apps — shape only, no colours" },
  { id: "json", label: "Recipe", hint: "Parts program + geometry as JSON" },
];

// Parts without a well-defined inside (flat planes) or with non-convex surfaces (tori)
// keep their triangle order; for every other primitive, triangles are turned to face outward.
const KEEP_WINDING = new Set(["plane", "torus"]);

type V = [number, number, number];

interface PartMesh {
  name: string;
  color: string;
  triangles: V[]; // flat list, 3 vertices per triangle, model space (z-up)
}

/** The model's faces grouped per part copy (expandProgram names nodes p{part}_{copy}_{vertex}). */
function partMeshes(shape: Shape3D, program: PartsProgram | null): PartMesh[] {
  const byId = new Map(shape.nodes.map((n) => [n.id, n]));
  const groups = new Map<string, { part?: number; copy: number; color: string; faces: Point3D[][] }>();

  for (const f of shape.faces || []) {
    const pts = f.nodeIds.map((id) => byId.get(id)).filter((n): n is Point3D => !!n);
    if (pts.length < 3) continue;
    const m = /^p(\d+)_(\d+)_/.exec(f.nodeIds[0]);
    const key = m ? `p${m[1]}_${m[2]}` : `color_${f.color ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { part: m ? Number(m[1]) : undefined, copy: m ? Number(m[2]) : 0, color: f.color || "#94a3b8", faces: [] };
      groups.set(key, group);
    }
    group.faces.push(pts);
  }

  return [...groups.values()].map((g) => {
    const part = g.part === undefined ? undefined : program?.parts[g.part];
    const orient = !!part && !KEEP_WINDING.has(part.type);

    let cx = 0, cy = 0, cz = 0, count = 0;
    if (orient) {
      for (const face of g.faces) {
        for (const p of face) {
          cx += p.x;
          cy += p.y;
          cz += p.z;
          count++;
        }
      }
      cx /= count;
      cy /= count;
      cz /= count;
    }

    const triangles: V[] = [];
    for (const face of g.faces) {
      for (let i = 1; i < face.length - 1; i++) {
        const a = face[0];
        let b = face[i];
        let c = face[i + 1];
        if (orient) {
          const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
          const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
          const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
          const dx = (a.x + b.x + c.x) / 3 - cx;
          const dy = (a.y + b.y + c.y) / 3 - cy;
          const dz = (a.z + b.z + c.z) / 3 - cz;
          if (nx * dx + ny * dy + nz * dz < 0) [b, c] = [c, b];
        }
        triangles.push([a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]);
      }
    }

    const base = part?.id || (g.part === undefined ? "surface" : `part_${g.part + 1}`);
    return { name: g.copy ? `${base}_${g.copy + 1}` : base, color: g.color, triangles };
  });
}

/** One named, coloured mesh per part copy. glTF/OBJ are y-up by convention; STL stays z-up for slicers. */
function buildGroup(shape: Shape3D, program: PartsProgram | null, yUp: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = shape.title || "Vertex model";
  for (const part of partMeshes(shape, program)) {
    const position = new Float32Array(part.triangles.length * 3);
    part.triangles.forEach(([x, y, z], i) => position.set(yUp ? [x, z, -y] : [x, y, z], i * 3));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      name: part.name,
      color: part.color,
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part.name;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return group;
}

const fileBase = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "vertex-model";

/** Build the export file in memory. */
export async function modelToFile(
  format: ExportFormat,
  shape: Shape3D,
  program: PartsProgram | null,
): Promise<{ blob: Blob; filename: string }> {
  if (!shape.nodes.length) throw new Error("There is no model to export yet.");
  const title = shape.title || "Vertex model";
  const name = fileBase(title);

  if (format === "json") {
    const json = JSON.stringify({ title, partsProgram: program, shape }, null, 2);
    return { blob: new Blob([json], { type: "application/json" }), filename: `${name}.json` };
  }

  const group = buildGroup(shape, program, format !== "stl");
  try {
    if (format === "glb") {
      const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
      return { blob: new Blob([glb], { type: "model/gltf-binary" }), filename: `${name}.glb` };
    }
    if (format === "obj") {
      return { blob: new Blob([new OBJExporter().parse(group)], { type: "text/plain" }), filename: `${name}.obj` };
    }
    const stl = new STLExporter().parse(group, { binary: true });
    return { blob: new Blob([stl.buffer as ArrayBuffer], { type: "model/stl" }), filename: `${name}.stl` };
  } finally {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

/** Build the export file and hand it to the browser as a download. */
export async function exportModel(format: ExportFormat, shape: Shape3D, program: PartsProgram | null): Promise<void> {
  const { blob, filename } = await modelToFile(format, shape, program);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
