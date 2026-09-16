/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Writes the exact math models into public/models. These are computed, not AI-generated:
 * a tesseract's 16 vertices and 32 edges are arithmetic, and a Möbius strip is a
 * parametrised surface — no language model should be guessing either.
 *
 *   npm run models:math
 */

import fs from "node:fs";
import path from "node:path";
import { generateMobiusStrip, generateTesseract } from "../src/math_shapes";
import type { Shape3D } from "../src/types";

const OUT = path.join(process.cwd(), "public", "models");

function write(id: string, shape: Shape3D) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(shape, null, 1));
  console.log(`${id}: ${shape.nodes.length} nodes, ${shape.edges.length} edges, ${shape.faces?.length ?? 0} faces`);
}

write("tesseract", generateTesseract());
write("mobius", generateMobiusStrip());
