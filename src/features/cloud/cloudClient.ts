/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Shape3D } from "../../types";
import type { PartsProgram } from "../studio/engine/primitives";

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface ModelSummary {
  id: string;
  title: string;
  nodeCount: number;
  updatedAt: string;
}

export interface SavedModel extends ModelSummary {
  shape: Shape3D;
  partsProgram: PartsProgram | null;
}

export interface ModelInput {
  title: string;
  shape: Shape3D;
  partsProgram: PartsProgram | null;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
  return json as T;
}

export const authApi = {
  me: () => request<{ user: User | null }>("GET", "/api/auth/me").then((r) => r.user),
  signup: (email: string, password: string) =>
    request<{ user: User }>("POST", "/api/auth/signup", { email, password }).then((r) => r.user),
  login: (email: string, password: string) =>
    request<{ user: User }>("POST", "/api/auth/login", { email, password }).then((r) => r.user),
  logout: () => request<unknown>("POST", "/api/auth/logout"),
};

export const modelsApi = {
  list: () => request<{ models: ModelSummary[] }>("GET", "/api/models").then((r) => r.models),
  get: (id: string) => request<{ model: SavedModel }>("GET", `/api/models/${id}`).then((r) => r.model),
  create: (input: ModelInput) => request<{ model: ModelSummary }>("POST", "/api/models", input).then((r) => r.model),
  update: (id: string, input: ModelInput) =>
    request<{ model: ModelSummary }>("PUT", `/api/models/${id}`, input).then((r) => r.model),
  remove: (id: string) => request<unknown>("DELETE", `/api/models/${id}`),
};
