/**
 * Harakumo platform client (server-side only).
 *
 * Auth, edge SQLite, object storage and mail over the Harakumo REST API
 * (https://harakumo.com/api/docs/all). The API key and pool secrets stay on the
 * server; the browser only ever sees our own /api routes and an httpOnly cookie.
 */

import crypto from "crypto";

const BASE = "https://harakumo.com";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see the Harakumo section of .env.example.`);
  return value;
}

export class HarakumoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${env("HARAKUMO_API_KEY")}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HarakumoError(json.error || `Harakumo ${method} ${path} failed (${res.status})`, res.status);
  return json as T;
}

// ---- database (edge SQLite: the last statement's rows come back as `results`) ----

export async function query<Row = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<Row[]> {
  const { results } = await call<{ results?: Row[] }>("POST", `/api/databases/${env("HARAKUMO_DATABASE_ID")}`, { sql, params });
  return results || [];
}

// ---- storage (presigned URLs; bytes go straight to the bucket) ----

async function presign(key: string, method: "put" | "get", contentType?: string): Promise<string> {
  const { url } = await call<{ url: string }>("POST", `/api/storage/${env("HARAKUMO_BUCKET_ID")}`, { key, method, contentType });
  return url;
}

export async function putJson(key: string, value: unknown): Promise<void> {
  const res = await fetch(await presign(key, "put", "application/json"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new HarakumoError(`Storage upload failed (${res.status})`, 502);
}

export async function getJson<T = unknown>(key: string): Promise<T | null> {
  const res = await fetch(await presign(key, "get"));
  if (res.status === 404) return null;
  if (!res.ok) throw new HarakumoError(`Storage download failed (${res.status})`, 502);
  return (await res.json()) as T;
}

export async function deleteObject(key: string): Promise<void> {
  await call("POST", `/api/storage/${env("HARAKUMO_BUCKET_ID")}`, { key, method: "delete" });
}

// ---- auth (per-project user pool, HS256 JWT sessions) ----

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

interface AuthResult {
  user: AuthUser;
  token: string;
  expiresIn: number; // seconds
}

async function authAction(action: "signup" | "login", email: string, password: string): Promise<AuthResult> {
  const r = await call<any>("POST", `/api/auth-pools/${env("HARAKUMO_AUTH_POOL_ID")}`, { action, email, password });
  return {
    user: { id: String(r.user.id), email: r.user.email, name: r.user.name },
    token: r.token,
    expiresIn: Number(r.expiresIn) || 604800,
  };
}

export const signup = (email: string, password: string) => authAction("signup", email, password);
export const login = (email: string, password: string) => authAction("login", email, password);

/** Verify a pool-issued session token locally with the pool's jwtSecret (no network hop). */
export function verifyToken(token: string): AuthUser | null {
  try {
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return null;
    if (JSON.parse(Buffer.from(h, "base64url").toString()).alg !== "HS256") return null;
    const expected = crypto.createHmac("sha256", env("HARAKUMO_AUTH_JWT_SECRET")).update(`${h}.${p}`).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    if (String(claims.pool) !== env("HARAKUMO_AUTH_POOL_ID")) return null;
    return { id: String(claims.sub), email: claims.email, name: claims.name };
  } catch {
    return null;
  }
}

// ---- mail (transactional, from no-reply@harakumo.com) ----

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await call("POST", "/api/mail/send", { to, subject, text });
}
