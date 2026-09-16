import express from "express";
import path from "path";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";
import * as hk from "./server/harakumo";

// Load environment variables
dotenv.config();


const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Claude powers 3D generation; the API key stays on the server (ANTHROPIC_API_KEY).
const CLAUDE_MODEL = "claude-opus-5";
let claudeClient: Anthropic | null = null;
function getClaude(): Anthropic {
  if (!claudeClient) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server.");
    claudeClient = new Anthropic();
  }
  return claudeClient;
}

// ---- Accounts: Harakumo auth pool. The pool-issued JWT lives in an httpOnly cookie ----
const SESSION_COOKIE = "vx_session";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCookies(req: any): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers?.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function getUser(req: any): hk.AuthUser | null {
  const token = parseCookies(req)[SESSION_COOKIE];
  return token ? hk.verifyToken(token) : null;
}

function setSessionCookie(res: any, token: string, expiresInSeconds: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: expiresInSeconds * 1000,
    path: "/",
  });
}

function requireAuth(req: any, res: any, next: any) {
  const user = getUser(req);
  if (!user) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  req.user = user;
  next();
}

/** Pass Harakumo's own 4xx messages through ("Invalid email or password"); hide 5xx details. */
function sendError(res: any, error: unknown, fallback: string) {
  const status = error instanceof hk.HarakumoError && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) console.error(fallback, error);
  res.status(status).json({ error: status === 500 ? fallback : (error as Error).message });
}

function readCredentials(req: any, res: any, { newAccount }: { newAccount: boolean }) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return null;
  }
  if (newAccount ? password.length < 8 : !password) {
    res.status(400).json({ error: newAccount ? "Password must be at least 8 characters." : "Enter your password." });
    return null;
  }
  return { email, password };
}

app.post("/api/auth/signup", async (req, res) => {
  const creds = readCredentials(req, res, { newAccount: true });
  if (!creds) return;
  try {
    const { user, token, expiresIn } = await hk.signup(creds.email, creds.password);
    setSessionCookie(res, token, expiresIn);
    // Best-effort welcome email; a mail failure must not fail the signup.
    hk.sendMail(
      user.email,
      "Welcome to Vertex",
      "Your Vertex account is ready.\n\nDescribe anything in the prompt bar and watch it light up in space. Models you save are kept in your account.\n\n— Vertex",
    ).catch((err) => console.error("Welcome email failed:", err));
    res.status(201).json({ user });
  } catch (error) {
    sendError(res, error, "Could not create the account.");
  }
});

app.post("/api/auth/login", async (req, res) => {
  const creds = readCredentials(req, res, { newAccount: false });
  if (!creds) return;
  try {
    const { user, token, expiresIn } = await hk.login(creds.email, creds.password);
    setSessionCookie(res, token, expiresIn);
    res.json({ user });
  } catch (error) {
    sendError(res, error, "Could not sign in.");
  }
});

// Current signed-in user, or null (200 either way, so signed-out visits don't log errors)
app.get("/api/auth/me", (req, res) => {
  res.json({ user: getUser(req) });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ success: true });
});

// Helper to normalize vocal/microphone prompts by stripping command prefixes and spelling errors
function cleanPromptForAI(text: string): string {
  let cleaned = text.trim();
  
  // 1. Remove introductory conversational speech tags
  cleaned = cleaned.replace(/^(jarvis|hey jarvis|please|can you|could you|would you mind|i want to|i need to|let's|lets)\b[,?\s]*/gi, "");
  
  // 2. Remove common action verbs and synonyms (especially misspelled ones)
  cleaned = cleaned.replace(/^(draw|render|generate|genrate|generarate|generat|creare|build|create|model|diagram|wireframe|chassis|structure|plot|make|construct|design|map|show)\b[,?\s]*/gi, "");
  
  // 3. Remove subsequent "a", "an", "the", "some", "of", "for", "to" if they appear at the start of the remaining phrase
  cleaned = cleaned.replace(/^(a|an|the|some|of|for|to)\b[,?\s]*/gi, "");
  
  // 4. If the remaining text is empty or very short, fall back to the original text
  if (cleaned.trim().length < 2) {
    return text.trim();
  }
  
  return cleaned.trim();
}

// ---- Saved models: metadata + parts recipe in Harakumo SQLite, full geometry in Harakumo storage ----

const MODELS_SCHEMA = `CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  parts_program TEXT,
  node_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS models_user ON models(user_id, updated_at);`;

let schemaReady: Promise<unknown> | null = null;
const ensureSchema = () =>
  (schemaReady ??= hk.query(MODELS_SCHEMA).catch((err) => {
    schemaReady = null; // retry on the next request
    throw err;
  }));

const MODEL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const shapeKey = (userId: string, id: string) => `models/${userId}/${id}.json`;

interface ModelRow {
  id: string;
  user_id: string;
  title: string;
  parts_program: string | null;
  node_count: number;
  created_at: string;
  updated_at: string;
}

const toSummary = (r: Pick<ModelRow, "id" | "title" | "node_count" | "updated_at">) => ({
  id: r.id,
  title: r.title,
  nodeCount: r.node_count,
  updatedAt: r.updated_at,
});

function readModelBody(req: any, res: any) {
  const { shape, partsProgram } = req.body || {};
  if (!shape || !Array.isArray(shape.nodes) || !Array.isArray(shape.edges) || !shape.nodes.length) {
    res.status(400).json({ error: "There is no model to save." });
    return null;
  }
  const title = String(req.body.title || shape.title || "Untitled").trim().slice(0, 120) || "Untitled";
  return { title, shape, partsProgram: partsProgram ? JSON.stringify(partsProgram) : null };
}

function readModelId(req: any, res: any): string | null {
  const id = String(req.params.id || "");
  if (!MODEL_ID_RE.test(id)) {
    res.status(404).json({ error: "Model not found." });
    return null;
  }
  return id;
}

app.get("/api/models", requireAuth, async (req: any, res) => {
  try {
    await ensureSchema();
    const rows = await hk.query<ModelRow>(
      "SELECT id, title, node_count, updated_at FROM models WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200",
      [req.user.id],
    );
    res.json({ models: rows.map(toSummary) });
  } catch (error) {
    sendError(res, error, "Could not load your models.");
  }
});

app.get("/api/models/:id", requireAuth, async (req: any, res) => {
  const id = readModelId(req, res);
  if (!id) return;
  try {
    await ensureSchema();
    const [row] = await hk.query<ModelRow>("SELECT * FROM models WHERE id = ? AND user_id = ?", [id, req.user.id]);
    const shape = row ? await hk.getJson(shapeKey(req.user.id, id)) : null;
    if (!row || !shape) {
      res.status(404).json({ error: "Model not found." });
      return;
    }
    res.json({
      model: { ...toSummary(row), shape, partsProgram: row.parts_program ? JSON.parse(row.parts_program) : null },
    });
  } catch (error) {
    sendError(res, error, "Could not open that model.");
  }
});

app.post("/api/models", requireAuth, async (req: any, res) => {
  const body = readModelBody(req, res);
  if (!body) return;
  try {
    await ensureSchema();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Geometry first, so a row never points at a missing object.
    await hk.putJson(shapeKey(req.user.id, id), body.shape);
    await hk.query(
      "INSERT INTO models (id, user_id, title, parts_program, node_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, req.user.id, body.title, body.partsProgram, body.shape.nodes.length, now, now],
    );
    res.status(201).json({ model: toSummary({ id, title: body.title, node_count: body.shape.nodes.length, updated_at: now }) });
  } catch (error) {
    sendError(res, error, "Could not save the model.");
  }
});

app.put("/api/models/:id", requireAuth, async (req: any, res) => {
  const id = readModelId(req, res);
  if (!id) return;
  const body = readModelBody(req, res);
  if (!body) return;
  try {
    await ensureSchema();
    const [row] = await hk.query<ModelRow>("SELECT id FROM models WHERE id = ? AND user_id = ?", [id, req.user.id]);
    if (!row) {
      res.status(404).json({ error: "Model not found." });
      return;
    }
    const now = new Date().toISOString();
    await hk.putJson(shapeKey(req.user.id, id), body.shape);
    await hk.query(
      "UPDATE models SET title = ?, parts_program = ?, node_count = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      [body.title, body.partsProgram, body.shape.nodes.length, now, id, req.user.id],
    );
    res.json({ model: toSummary({ id, title: body.title, node_count: body.shape.nodes.length, updated_at: now }) });
  } catch (error) {
    sendError(res, error, "Could not save the model.");
  }
});

app.delete("/api/models/:id", requireAuth, async (req: any, res) => {
  const id = readModelId(req, res);
  if (!id) return;
  try {
    await ensureSchema();
    const rows = await hk.query("DELETE FROM models WHERE id = ? AND user_id = ? RETURNING id", [id, req.user.id]);
    if (!rows.length) {
      res.status(404).json({ error: "Model not found." });
      return;
    }
    await hk.deleteObject(shapeKey(req.user.id, id)).catch((err) => console.error("Model geometry delete failed:", err));
    res.json({ deleted: true });
  } catch (error) {
    sendError(res, error, "Could not delete the model.");
  }
});

// ---- AI 3D generation: Claude designs a parts program; the client expands it into dots ----

class GenerationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Token usage for one generation, as reported by the API (output includes thinking tokens). */
interface BuildUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  ms: number;
}

async function generateParts(userContent: string): Promise<{ data: unknown; usage: BuildUsage; reasoning: string }> {
  const started = Date.now();
  let response: Anthropic.Beta.BetaMessage;
  try {
    // Streamed so large (High/Ultra detail) programs have output room without HTTP timeouts.
    const stream = getClaude().beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      // On a safety decline, re-run on Anthropic's recommended fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Summarized thinking is returned so the chat can reveal Claude's reasoning (billing is unchanged).
      thinking: { type: "adaptive", display: "summarized" },
      cache_control: { type: "ephemeral" },
      system: PARTS_SYSTEM,
      // Effort "medium": default "high" took ~3 minutes per model, too slow for an interactive prompt bar.
      output_config: { effort: "medium", format: { type: "json_schema", schema: PARTS_SCHEMA } },
      messages: [{ role: "user", content: userContent }],
    });
    response = await stream.finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new GenerationError("The server's Claude API key was rejected.", 500);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new GenerationError("Claude is rate-limited right now. Wait a moment and try again.", 429);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new GenerationError("Couldn't reach Claude. Please try again.", 503);
    }
    if (error instanceof Anthropic.APIError && (error.status ?? 500) >= 500) {
      throw new GenerationError("Claude is briefly unavailable. Please try again.", 503);
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new GenerationError("Claude declined to build that. Try describing something else.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new GenerationError("That model was too large to finish. Try a simpler description.", 422);
  }
  const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const usage: BuildUsage = {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    ms: Date.now() - started,
  };
  const reasoning = response.content
    .map((block) => (block.type === "thinking" ? block.thinking : ""))
    .filter(Boolean)
    .join("\n\n");
  try {
    return { data: JSON.parse(text), usage, reasoning };
  } catch {
    throw new GenerationError("Claude returned an unreadable model. Please try again.", 502);
  }
}

const PARTS_SYSTEM = `You are a 3D CAD assembler. Describe the requested object as an ASSEMBLY OF PARAMETRIC PRIMITIVES — never raw vertices.

Coordinate frame (right-handed): x = length (front<->back), y = width (left<->right), z = height (up). Keep coordinates within about -250..250.

Primitive 'type' values and params:
- box: size [sx,sy,sz]
- wedge: size [sx,sy,sz]  (a ramp / triangular prism rising along +x — cabins, noses, spoilers, roofs)
- plane: size [a,b], axis (x|y|z = the normal)
- cylinder: radius, length, axis (x|y|z), segments  (wheels, tubes, fuselage, legs)
- cone: radius, length, axis, segments  (nose cones, tips, funnels, spikes)
- sphere: radius, segments, rings  (domes, heads, pods)
- torus: radius, tube, segments, sides  (rings, tyres)

Every part also takes: center [x,y,z], color (hex), opacity (0.15-0.6), and optional rotate [rx,ry,rz] in degrees.

USE SYMMETRY — this is mandatory and is the key to good models:
- mirror: ["y"] reflects a copy across the y=0 plane (left<->right). ["x","y"] yields 4 copies.
- array: { axis, count, spacing } repeats a part in a line — windows, fins, floors, railings.
- You MUST use mirror for any left-right symmetric object (vehicles, aircraft, furniture, buildings). NEVER hand-place mirrored copies as separate parts.
  Example — the 4 wheels of a car are ONE part:
  { "type":"cylinder","id":"wheel","center":[120,85,-30],"radius":35,"length":30,"axis":"y","mirror":["x","y"] }

Build in THREE passes — this is how you make an object detailed and recognisable:
1. PRIMARY MASSES — the big silhouette (chassis + cabin, fuselage + wings, tower core).
2. FUNCTIONAL FEATURES — the parts that say what it IS (wheels, windscreen, engines, doors, fins, rotor).
3. FINE DETAIL & ACCENTS — headlights, grille, side mirrors, panel lines, antennae, window rows, trim. These read as "greebles" and are what separate a sharp model from a crude blob. Use array/mirror to add many cheaply.

Always include the SIGNATURE features that make the object unmistakable. Examples:
- car: 4 wheels, raked windscreen, headlights, grille, side mirrors, door seam, exhaust
- rocket: body tube, nose cone, fins (array around axis via rotate+mirror), engine nozzle(s), fairing line
- building: floor slabs (array up z), window grid (array x and z), roof detail, entrance, columns
- aircraft: fuselage, swept wings (mirror), tail fin + stabilisers, engine nacelles, cockpit canopy

Rules:
- Use the part budget given with the request: simple objects at its low end; vehicles, aircraft, machines and buildings at its high end. Do NOT be sparse — richer is better, as long as every part is meaningful.
- Always prefer ONE part + mirror/array over hand-placed near-duplicates. A window grid is array×array, not 20 boxes.
- Give every part a semantic id ('chassis','cabin','wheel','headlight','mirror','grille','fin').
- Realistic proportions: study the real object's ratios. Wheels/legs at the base, cabins/cockpits on top, details on the surface.
- Keep the main body a SLAB (thin in its vertical z) — wheels, cabins and details must clearly PROTRUDE, never be swallowed by one big block.
- Use DISTINCT colours per component so parts read separately. Solid bodies opacity ~0.35, glass ~0.2, wheels/lights/metal opaque (~0.9).

Worked example — a detailed car. ONE mirrored wheel becomes four; headlights and mirrors are mirrored pairs; the chassis stays a thin slab:
{"title":"Sport Coupe","parts":[
  {"type":"box","id":"chassis","center":[0,0,0],"size":[420,150,34],"color":"#1e3a8a","opacity":0.4},
  {"type":"wedge","id":"cabin","center":[25,0,52],"size":[170,138,70],"color":"#3b82f6","opacity":0.3},
  {"type":"box","id":"hood","center":[-150,0,12],"size":[110,140,20],"color":"#1e3a8a","opacity":0.4},
  {"type":"box","id":"trunk","center":[170,0,12],"size":[90,140,22],"color":"#1e3a8a","opacity":0.4},
  {"type":"cylinder","id":"wheel","center":[130,82,-30],"radius":42,"length":30,"axis":"y","segments":18,"color":"#0f172a","mirror":["x","y"]},
  {"type":"cylinder","id":"hubcap","center":[130,98,-30],"radius":18,"length":4,"axis":"y","segments":12,"color":"#94a3b8","mirror":["x","y"]},
  {"type":"box","id":"headlight","center":[-198,52,8],"size":[16,34,16],"color":"#fde68a","opacity":0.95,"mirror":["y"]},
  {"type":"box","id":"grille","center":[-205,0,2],"size":[10,90,24],"color":"#0f172a"},
  {"type":"box","id":"mirror","center":[-40,80,46],"size":[14,18,12],"color":"#1e3a8a","mirror":["y"]},
  {"type":"box","id":"spoiler","center":[205,0,52],"size":[24,150,8],"color":"#22d3ee","opacity":0.7}
]}`;

const VEC3 = { type: "array", items: { type: "number" }, description: "[x, y, z]" };
const AXIS = { type: "string", enum: ["x", "y", "z"] };

/** JSON schema for a parts program — mirrors `Part` in src/features/studio/engine/primitives.ts. */
const PARTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "parts"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id", "center", "color"],
        properties: {
          type: { type: "string", enum: ["box", "wedge", "plane", "cylinder", "cone", "sphere", "torus"] },
          id: { type: "string" },
          center: VEC3,
          size: { type: "array", items: { type: "number" }, description: "box/wedge: [sx, sy, sz]; plane: [a, b]" },
          radius: { type: "number" },
          length: { type: "number" },
          tube: { type: "number" },
          axis: AXIS,
          segments: { type: "integer" },
          rings: { type: "integer" },
          sides: { type: "integer" },
          color: { type: "string", description: "hex colour, e.g. #3b82f6" },
          opacity: { type: "number" },
          rotate: { ...VEC3, description: "[rx, ry, rz] in degrees" },
          mirror: { type: "array", items: AXIS },
          array: {
            type: "object",
            additionalProperties: false,
            required: ["axis", "count", "spacing"],
            properties: { axis: AXIS, count: { type: "integer" }, spacing: { type: "number" } },
          },
        },
      },
    },
  },
};

// Part budgets per detail level — must match src/features/studio/detail.ts.
const PART_BUDGETS: Record<string, string> = {
  normal: "10-45 parts",
  high: "40-110 parts",
  ultra: "80-200 parts",
};

// Generate a new model, or apply an instruction to the current one (mode "edit").
app.post("/api/generate", async (req, res) => {
  const { prompt, mode, current, history, detail } = req.body || {};
  const budget = `\n\nPart budget: ${PART_BUDGETS[detail] ?? PART_BUDGETS.normal}.`;
  // Earlier prompts in the same chat, so edits understand what the user has been asking for.
  const earlier = Array.isArray(history) ? history.filter((h): h is string => typeof h === "string").slice(-10) : [];
  const context = earlier.length
    ? `Earlier requests in this conversation, oldest first:\n${earlier.map((h) => `- ${h}`).join("\n")}\n\n`
    : "";
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing or invalid prompt parameter." });
    return;
  }
  const cleaned = cleanPromptForAI(prompt);
  const isEdit = mode === "edit" && current && Array.isArray(current.parts);
  try {
    const { data, usage, reasoning } = await generateParts(
      isEdit
        ? `${context}Here is the current model as a parts program:\n${JSON.stringify(current)}\n\nApply this change to it: "${cleaned}". Return the complete updated parts program, keeping the parts the change doesn't touch exactly as they are.${budget}`
        : `Design this object as an assembly of parametric primitives: "${cleaned}"${budget}`,
    );
    res.json({ mode: "parts", model: usage.model, data, usage, reasoning });
  } catch (error) {
    if (error instanceof GenerationError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Generation error:", error);
    res.status(500).json({ error: "Generation failed. Please try again." });
  }
});

// Real-world building footprints from OpenStreetMap (Overpass), for real-scale 3D.
app.get("/api/geo/buildings", async (req, res) => {
  try {
    const bbox = typeof req.query.bbox === "string" ? req.query.bbox : "";
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
      res.status(400).json({ error: "Provide bbox as south,west,north,east." });
      return;
    }
    const [s, w, n, e] = parts;
    if (n - s > 0.05 || e - w > 0.05) {
      res.status(400).json({ error: "Area too large — zoom in (max ~5km)." });
      return;
    }
    const query = `[out:json][timeout:25];way["building"](${s},${w},${n},${e});(._;>;);out body;`;
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);
    const r = await fetch(url, { headers: { "User-Agent": "VertexStudio/1.0 (3D city POC)" } });
    if (!r.ok) {
      res.status(502).json({ error: `OpenStreetMap fetch failed (${r.status}). Try again shortly.` });
      return;
    }
    const data: any = await r.json();
    res.json({ elements: data.elements || [] });
  } catch (error: any) {
    console.error("Geo buildings error:", error);
    res.status(502).json({ error: error?.message || "Failed to fetch building data." });
  }
});

// Configure Vite middleware or static files serving
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite dev server middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving production build from dist folder...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const startServer = (port: number) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Server successfully started and listening on http://localhost:${port}`);
    });
    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} is in use, trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error("Server error:", err);
      }
    });
  };
  startServer(PORT);
}

setupVite().catch((err) => {
  console.error("Vite startup error:", err);
});
