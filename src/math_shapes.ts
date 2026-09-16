/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point3D, Edge3D, Face3D, Shape3D } from "./types";

/**
 * Helper to generate gorgeous neon/pastel gradients in HEX format.
 */
function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Generate a 4D Hypercube (Tesseract) projected into 3D.
 */
export function generateTesseract(): Shape3D {
  const nodes: Point3D[] = [];
  const edges: Edge3D[] = [];
  const faces: Face3D[] = [];

  // Generate 16 vertices of hypercube in 4D: coordinates x,y,z,w are either -1 or 1
  const coords = [-1, 1];
  let idCounter = 0;

  // Store 4D coordinates
  const points4D: { x: number; y: number; z: number; w: number; id: string }[] = [];

  for (const x of coords) {
    for (const y of coords) {
      for (const z of coords) {
        for (const w of coords) {
          const id = `tess_${idCounter++}`;
          points4D.push({ x, y, z, w, id });
        }
      }
    }
  }

  // W-perspective projection down to 3D
  const D = 2;
  const factor = 70; // scaling

  points4D.forEach((p) => {
    // scale factor depending on W-depth
    const scale = factor / (D - p.w * 0.4);
    // Custom neon colors: Inner cube (w = -1) is glowing violet, Outer (w = 1) is glowing sky cyan
    const color = p.w > 0 ? "#38bdf8" : "#a855f7";
    
    nodes.push({
      id: p.id,
      x: p.x * scale,
      y: p.y * scale,
      z: p.z * scale,
      color,
      label: `W:${p.w > 0 ? "+1" : "-1"}`,
    });
  });

  // Connect edges where Manhattan distance in 4D space is exactly 1 (only 1 coordinate changes)
  let edgeCounter = 0;
  for (let i = 0; i < points4D.length; i++) {
    for (let j = i + 1; j < points4D.length; j++) {
      const p1 = points4D[i];
      const p2 = points4D[j];

      let diffCount = 0;
      if (p1.x !== p2.x) diffCount++;
      if (p1.y !== p2.y) diffCount++;
      if (p1.z !== p2.z) diffCount++;
      if (p1.w !== p2.w) diffCount++;

      if (diffCount === 1) {
        // Color edges by category: Outer edges (blue), Inner edges (purple), Connectors (indigo)
        let edgeColor = "#6366f1"; // Connector default
        if (p1.w > 0 && p2.w > 0) edgeColor = "#38bdf8"; // Outer
        else if (p1.w < 0 && p2.w < 0) edgeColor = "#c084fc"; // Inner

        edges.push({
          id: `tess_edge_${edgeCounter++}`,
          source: p1.id,
          target: p2.id,
          color: edgeColor,
        });
      }
    }
  }

  // --- GENERATE 24 TESSERACT SOLID MESH FACES ---
  // Inner cube indices: even indices (0, 2, 4, 6, 8, 10, 12, 14)
  // o0..o7 map to odd indices (1, 3, 5, 7, 9, 11, 13, 15)
  // Let's specify 6 faces of inner cube (tess_0, tess_2, tess_6, tess_4, etc.)
  const innerFacesNodeIds = [
    ["tess_0", "tess_2", "tess_6", "tess_4"],   // Left (x = -1)
    ["tess_8", "tess_12", "tess_14", "tess_10"], // Right (x = 1)
    ["tess_0", "tess_8", "tess_10", "tess_2"],   // Bottom (y = -1)
    ["tess_4", "tess_6", "tess_14", "tess_12"], // Top (y = 1)
    ["tess_0", "tess_4", "tess_12", "tess_8"],   // Front (z = -1)
    ["tess_2", "tess_10", "tess_14", "tess_6"]   // Back (z = 1)
  ];

  const outerFacesNodeIds = [
    ["tess_1", "tess_3", "tess_7", "tess_5"],   // Left (x = -1)
    ["tess_9", "tess_13", "tess_15", "tess_11"], // Right (x = 1)
    ["tess_1", "tess_9", "tess_11", "tess_3"],   // Bottom (y = -1)
    ["tess_5", "tess_7", "tess_15", "tess_13"], // Top (y = 1)
    ["tess_1", "tess_5", "tess_13", "tess_9"],   // Front (z = -1)
    ["tess_3", "tess_11", "tess_15", "tess_7"]   // Back (z = 1)
  ];

  // 12 connecting faces between inner and outer cubes
  const connectorFacesNodeIds = [
    ["tess_0", "tess_1", "tess_3", "tess_2"],
    ["tess_2", "tess_3", "tess_7", "tess_6"],
    ["tess_6", "tess_7", "tess_5", "tess_4"],
    ["tess_4", "tess_5", "tess_1", "tess_0"],
    ["tess_8", "tess_9", "tess_11", "tess_10"],
    ["tess_10", "tess_11", "tess_15", "tess_14"],
    ["tess_14", "tess_15", "tess_13", "tess_12"],
    ["tess_12", "tess_13", "tess_9", "tess_8"],
    ["tess_0", "tess_1", "tess_9", "tess_8"],
    ["tess_2", "tess_3", "tess_11", "tess_10"],
    ["tess_6", "tess_7", "tess_15", "tess_14"],
    ["tess_4", "tess_5", "tess_13", "tess_12"]
  ];

  let faceCounter = 0;
  
  innerFacesNodeIds.forEach(nodesList => {
    faces.push({
      id: `tess_face_${faceCounter++}`,
      nodeIds: nodesList,
      color: "#8b5cf6", // Violet surface
      opacity: 0.35
    });
  });

  outerFacesNodeIds.forEach(nodesList => {
    faces.push({
      id: `tess_face_${faceCounter++}`,
      nodeIds: nodesList,
      color: "#0ea5e9", // Sky Blue surface
      opacity: 0.25
    });
  });

  connectorFacesNodeIds.forEach(nodesList => {
    faces.push({
      id: `tess_face_${faceCounter++}`,
      nodeIds: nodesList,
      color: "#6366f1", // Indigo surface
      opacity: 0.18
    });
  });

  return {
    title: "Tesseract (Hypercube)",
    description: "A 4D hypercube projected into 3D coordinate space. Rendered in a gorgeous cyberpunk theme with semi-transparent violet, cyan, and indigo solid mesh panels.",
    nodes,
    edges,
    faces,
  };
}

/**
 * Generate a DNA Double Helix.
 */
export function generateDoubleHelix(): Shape3D {
  const nodes: Point3D[] = [];
  const edges: Edge3D[] = [];
  const faces: Face3D[] = [];

  const pointsCount = 20;
  const radius = 45;
  const heightScale = 7;
  const rawOffset = (pointsCount - 1) * heightScale / 2;

  let edgeCounter = 0;
  let faceCounter = 0;

  for (let i = 0; i < pointsCount; i++) {
    const t = (i / pointsCount) * Math.PI * 4; // 2 complete turns
    const py = i * heightScale - rawOffset;

    // Strand A color shifting (neon pink/magenta)
    const hueA = 320 + (i / pointsCount) * 40;
    const colorA = hslToHex(hueA, 95, 60);

    // Strand B color shifting (neon cyan/teal)
    const hueB = 180 + (i / pointsCount) * 40;
    const colorB = hslToHex(hueB, 95, 60);

    // Helix strand A
    const idA = `helix_a_${i}`;
    const ax = Math.cos(t) * radius;
    const az = Math.sin(t) * radius;
    nodes.push({ id: idA, x: ax, y: py, z: az, color: colorA, label: `Strand A - ${i}` });

    // Helix strand B (pi offset)
    const idB = `helix_b_${i}`;
    const bx = Math.cos(t + Math.PI) * radius;
    const bz = Math.sin(t + Math.PI) * radius;
    nodes.push({ id: idB, x: bx, y: py, z: bz, color: colorB, label: `Strand B - ${i}` });

    // Thread connections along the sides
    if (i > 0) {
      edges.push({
        id: `helix_edge_a_${edgeCounter++}`,
        source: `helix_a_${i - 1}`,
        target: idA,
        color: colorA,
      });
      edges.push({
        id: `helix_edge_b_${edgeCounter++}`,
        source: `helix_b_${i - 1}`,
        target: idB,
        color: colorB,
      });

      // Draw ribbon face panels along the strands to form a solid DNA ladder!
      faces.push({
        id: `helix_ribbon_face_${faceCounter++}`,
        nodeIds: [`helix_a_${i-1}`, `helix_b_${i-1}`, idB, idA],
        color: i % 2 === 0 ? "#ec4899" : "#14b8a6", // Shifting pink and teal mesh
        opacity: 0.15
      });
    }

    // Horizontal rungs joining strands (base pairs)
    // Alternate base pair colors: Adenine-Thymine (Green/Red), Cytosine-Guanine (Blue/Yellow)
    if (i % 2 === 0) {
      let rungColor = "#ef4444"; // Red
      if (i % 4 === 0) rungColor = "#22c55e"; // Green
      else if (i % 4 === 2) rungColor = "#eab308"; // Yellow

      edges.push({
        id: `helix_rung_${edgeCounter++}`,
        source: idA,
        target: idB,
        color: rungColor,
      });
    }
  }

  return {
    title: "Double Helix (DNA)",
    description: "Two intertwined spirals rotating in space connected by regular parallel base-pair rungs, wrapped in transparent pink and teal surface mesh ribbons.",
    nodes,
    edges,
    faces,
  };
}

/**
 * Generate a 3D Sphere.
 */
export function generateSphere(): Shape3D {
  const nodes: Point3D[] = [];
  const edges: Edge3D[] = [];
  const faces: Face3D[] = [];

  const latBands = 8;
  const lonBands = 12;
  const radius = 65;

  const nodeMap: { [key: string]: string } = {};

  // Create points
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands; // Latitude (0 to pi)
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    // Compute latitude specific color: Solar Yellow/Orange at equator, Deep Teal at poles
    const latFactor = lat / latBands;
    const hue = 180 - latFactor * 140; // Shifting from deep cyan (180) to bright gold (40)
    const nodeColor = hslToHex(hue, 95, 55);

    for (let lon = 0; lon < lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands; // Longitude (0 to 2pi)
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = radius * sinTheta * cosPhi;
      const y = radius * cosTheta;
      const z = radius * sinTheta * sinPhi;

      const id = `sph_${lat}_${lon}`;
      nodes.push({ id, x, y, z, color: nodeColor });
      nodeMap[`${lat}_${lon}`] = id;
    }
  }

  // Generate edges & quad faces
  let edgeCounter = 0;
  let faceCounter = 0;

  for (let lat = 0; lat < latBands; lat++) {
    const faceHue = 180 - ((lat + 0.5) / latBands) * 140;
    const faceColor = hslToHex(faceHue, 90, 50);

    for (let lon = 0; lon < lonBands; lon++) {
      const nextLon = (lon + 1) % lonBands;

      const n1 = nodeMap[`${lat}_${lon}`];
      const n2 = nodeMap[`${lat}_${nextLon}`];
      const n3 = nodeMap[`${lat + 1}_${nextLon}`];
      const n4 = nodeMap[`${lat + 1}_${lon}`];

      // Connect along rings
      if (lat > 0) {
        edges.push({
          id: `sph_edge_lat_${edgeCounter++}`,
          source: n1,
          target: n2,
          color: faceColor,
        });
      }

      // Connect vertically
      edges.push({
        id: `sph_edge_lon_${edgeCounter++}`,
        source: n1,
        target: n4,
        color: faceColor,
      });

      // Construct sphere surface quads!
      faces.push({
        id: `sph_face_${faceCounter++}`,
        nodeIds: [n1, n2, n3, n4],
        color: faceColor,
        opacity: 0.35
      });
    }
  }

  // Draw final closing vertical edges at polar latitude
  for (let lon = 0; lon < lonBands; lon++) {
    const nextLon = (lon + 1) % lonBands;
    edges.push({
      id: `sph_edge_lat_closing_${edgeCounter++}`,
      source: nodeMap[`${latBands}_${lon}`],
      target: nodeMap[`${latBands}_${nextLon}`],
      color: "#f43f5e",
    });
  }

  return {
    title: "Latitude-Longitude Sphere",
    description: "A gorgeous glowing sphere solid mesh, displaying a smooth thermal latitude-based gradient from solar orange up to arctic deep cyan.",
    nodes,
    edges,
    faces,
  };
}

/**
 * Generate a 3D Torus (Donut).
 */
export function generateTorus(): Shape3D {
  const nodes: Point3D[] = [];
  const edges: Edge3D[] = [];
  const faces: Face3D[] = [];

  const majorSegments = 16;
  const minorSegments = 8;
  const majorRadius = 55;
  const minorRadius = 22;

  let edgeCounter = 0;
  let faceCounter = 0;

  for (let i = 0; i < majorSegments; i++) {
    const u = (i * 2 * Math.PI) / majorSegments;
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);

    // Torus copper-gold gradient
    const ringHue = (i / majorSegments) * 360;
    const nodeColor = hslToHex(ringHue, 85, 55);

    for (let j = 0; j < minorSegments; j++) {
      const v = (j * 2 * Math.PI) / minorSegments;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);

      // Torus equations
      const x = (majorRadius + minorRadius * cosV) * cosU;
      const z = (majorRadius + minorRadius * cosV) * sinU;
      const y = minorRadius * sinV;

      const id = `torus_${i}_${j}`;
      nodes.push({ id, x, y, z, color: nodeColor });
    }
  }

  // Connect edges & quad faces
  for (let i = 0; i < majorSegments; i++) {
    const nextI = (i + 1) % majorSegments;
    const ringHue = (i / majorSegments) * 360;
    const faceColor = hslToHex(ringHue, 90, 50);

    for (let j = 0; j < minorSegments; j++) {
      const nextJ = (j + 1) % minorSegments;

      const n1 = `torus_${i}_${j}`;
      const n2 = `torus_${i}_${nextJ}`;
      const n3 = `torus_${nextI}_${nextJ}`;
      const n4 = `torus_${nextI}_${j}`;

      // Connect along minor columns
      edges.push({
        id: `tor_edge_v_${edgeCounter++}`,
        source: n1,
        target: n2,
        color: faceColor,
      });

      // Connect along major rows
      edges.push({
        id: `tor_edge_h_${edgeCounter++}`,
        source: n1,
        target: n4,
        color: faceColor,
      });

      // Create torus face panel quads!
      faces.push({
        id: `tor_face_${faceCounter++}`,
        nodeIds: [n1, n2, n3, n4],
        color: faceColor,
        opacity: 0.3
      });
    }
  }

  return {
    title: "Continuous 3D Torus",
    description: "A continuous ring torus mesh rendered with translucent golden-copper metallic panels showcasing hollow interior geometry.",
    nodes,
    edges,
    faces,
  };
}

/**
 * Generate Lorenz Chaotic Attractor trace.
 */
export function generateLorenzAttractor(): Shape3D {
  const nodes: Point3D[] = [];
  const edges: Edge3D[] = [];

  // Lorenz parameter constants
  const sigma = 10;
  const rho = 28;
  const beta = 8.0 / 3.0;

  let x = 0.1;
  let y = 0.0;
  let z = 0.0;
  const dt = 0.012;

  const pointsCount = 120;

  for (let i = 0; i < pointsCount; i++) {
    // Derivatives
    const dx = sigma * (y - x) * dt;
    const dy = (x * (rho - z) - y) * dt;
    const dz = (x * y - beta * z) * dt;

    x += dx;
    y += dy;
    z += dz;

    const px = x * 2.8;
    const py = (z - 25) * 2.5; 
    const pz = y * 2.8;

    // Shift colors along the trajectory path (spectrometric flow!)
    const hue = (i / pointsCount) * 280;
    const color = hslToHex(hue, 95, 60);

    const id = `lorenz_${i}`;
    nodes.push({
      id,
      x: px,
      y: py,
      z: pz,
      color,
      label: i % 20 === 0 ? `t:${i}` : undefined,
    });

    if (i > 0) {
      edges.push({
        id: `lorenz_edge_${i}`,
        source: `lorenz_${i - 1}`,
        target: id,
        color,
      });
    }
  }

  // The Lorenz attractor is a 1D chaotic state trajectory curve, so it doesn't have 2D faces.
  // We leave its faces array empty.
  return {
    title: "Lorenz Chaotic Attractor",
    description: "A chaotic 3D orbit trace representing the butterfly weather system, rendered in a magnificent shifting neon spectrum line.",
    nodes,
    edges,
    faces: [],
  };
}

/**
 * Create a simple Mobius Strip.
 */
export function generateMobiusStrip(): Shape3D {
  const nodes: Point3D[] = [];
  const edges: Edge3D[] = [];
  const faces: Face3D[] = [];

  const mainSegments = 16;
  const widthSegments = 2; // -1 to 1 ribbon bounds

  const radius = 60;
  const width = 18;
  let edgeCounter = 0;
  let faceCounter = 0;

  // Render vertices
  for (let i = 0; i < mainSegments; i++) {
    const theta = (i * 2 * Math.PI) / mainSegments;
    const ringHue = (i / mainSegments) * 360;
    const nodeColor = hslToHex(ringHue, 95, 55);

    for (let j = 0; j <= widthSegments; j++) {
      const v = (j / widthSegments) * 2 - 1; // ranges -1 to +1

      // Mobius parameter formulas:
      const alpha = theta / 2;
      const r = radius + v * width * Math.cos(alpha);

      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      const y = v * width * Math.sin(alpha);

      const id = `mob_${i}_${j}`;
      nodes.push({ id, x, y, z, color: nodeColor });
    }
  }

  // Make mesh connections & quad faces
  for (let i = 0; i < mainSegments; i++) {
    const nextI = (i + 1) % mainSegments;
    const ringHue = (i / mainSegments) * 360;
    const faceColor = hslToHex(ringHue, 95, 50);

    for (let j = 0; j <= widthSegments; j++) {
      // Connect vertical ribbon rings
      if (j < widthSegments) {
        edges.push({
          id: `mob_v_${edgeCounter++}`,
          source: `mob_${i}_${j}`,
          target: `mob_${i}_${j + 1}`,
          color: faceColor,
        });
      }

      // Connect along ribbon circumference
      // Note the Mobius boundary twist at the closure! (u changes to u+2pi means v flips polarity)
      if (i < mainSegments - 1) {
        edges.push({
          id: `mob_h_${edgeCounter++}`,
          source: `mob_${i}_${j}`,
          target: `mob_${nextI}_${j}`,
          color: faceColor,
        });
      } else {
        const targetJ = widthSegments - j;
        edges.push({
          id: `mob_twist_h_${edgeCounter++}`,
          source: `mob_${i}_${j}`,
          target: `mob_0_${targetJ}`,
          color: faceColor,
        });
      }

      // Generate the twist quad ribbon face panels!
      if (j < widthSegments) {
        const n1 = `mob_${i}_${j}`;
        const n2 = `mob_${i}_${j + 1}`;
        
        let n3 = "";
        let n4 = "";

        if (i < mainSegments - 1) {
          n3 = `mob_${nextI}_${j + 1}`;
          n4 = `mob_${nextI}_${j}`;
        } else {
          // twisted closure wrap
          n3 = `mob_0_${widthSegments - (j + 1)}`;
          n4 = `mob_0_${widthSegments - j}`;
        }

        faces.push({
          id: `mob_face_${faceCounter++}`,
          nodeIds: [n1, n2, n3, n4],
          color: faceColor,
          opacity: 0.4
        });
      }
    }
  }

  return {
    title: "Möbius Strip Ribbon",
    description: "A gorgeous single-sided Möbius strip ribbon, colored with a looping neon cyberpunk shifting spectrum, showing a 180-degree topological twist.",
    nodes,
    edges,
    faces,
  };
}

/**
 * Generate standard 3D Grid Guide points.
 */
export function generateGridPoints(gridSize: number, spacing: number): Point3D[] {
  const points: Point3D[] = [];
  const offset = ((gridSize - 1) * spacing) / 2;

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      for (let z = 0; z < gridSize; z++) {
        const posX = x * spacing - offset;
        const posY = y * spacing - offset;
        const posZ = z * spacing - offset;

        points.push({
          id: `g_${x}_${y}_${z}`,
          x: posX,
          y: posY,
          z: posZ,
          isGridPoint: true,
        });
      }
    }
  }
  return points;
}
