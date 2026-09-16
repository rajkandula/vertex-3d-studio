/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Trash2, UserRound } from "lucide-react";
import { useStudio } from "../studio/state/studioStore";
import { authApi, modelsApi, type ModelSummary, type User } from "./cloudClient";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The only chrome besides the prompt bar: an account button that opens sign-in and saved models. */
export function AccountPanel() {
  const { state, dispatch } = useStudio();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = still checking
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    authApi.me().then(setUser).catch(() => setUser(null));
  }, []);

  const refresh = useCallback(() => modelsApi.list().then(setModels), []);

  useEffect(() => {
    if (user && open) refresh().catch((e) => setError(e.message));
  }, [user, open, refresh]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const submitAuth = (e: FormEvent) => {
    e.preventDefault();
    act("auth", async () => {
      setUser(mode === "signup" ? await authApi.signup(email, password) : await authApi.login(email, password));
      setPassword("");
    });
  };

  const save = () =>
    act("save", async () => {
      const input = { title: state.shape.title || "Untitled", shape: state.shape, partsProgram: state.partsProgram };
      if (state.cloudId) {
        await modelsApi.update(state.cloudId, input);
      } else {
        const created = await modelsApi.create(input);
        dispatch({ type: "SET_CLOUD_ID", id: created.id });
      }
      dispatch({ type: "SET_STATUS", status: "Saved to your account." });
      await refresh();
    });

  const load = (id: string) =>
    act(`load:${id}`, async () => {
      const model = await modelsApi.get(id);
      // A saved model opens in its own chat, so the current conversation is left untouched.
      dispatch({
        type: "NEW_CHAT",
        seed: { title: model.title, shape: model.shape, partsProgram: model.partsProgram, cloudId: model.id },
      });
      setOpen(false);
    });

  const remove = (m: ModelSummary) => {
    if (!window.confirm(`Delete “${m.title}”? This can’t be undone.`)) return;
    act(`delete:${m.id}`, async () => {
      await modelsApi.remove(m.id);
      if (state.cloudId === m.id) dispatch({ type: "SET_CLOUD_ID", id: null });
      await refresh();
    });
  };

  const signOut = () =>
    act("logout", async () => {
      await authApi.logout();
      setUser(null);
      setModels([]);
      dispatch({ type: "SET_CLOUD_ID", id: null });
    });

  const hasModel = state.shape.nodes.length > 0;

  return (
    <div className="acct" ref={rootRef}>
      <button className="acct-btn" onClick={() => setOpen((o) => !o)} aria-label="Account" aria-expanded={open}>
        {user ? <span className="acct-initial">{user.email[0].toUpperCase()}</span> : <UserRound size={17} />}
      </button>

      {open && (
        <div className="acct-panel">
          {user === undefined ? (
            <div className="acct-muted">Checking your account…</div>
          ) : user ? (
            <>
              <div className="acct-head">
                <span className="acct-email">{user.email}</span>
                <button className="acct-link" onClick={signOut} disabled={busy !== null}>
                  Sign out
                </button>
              </div>
              <button className="acct-primary" onClick={save} disabled={!hasModel || busy !== null}>
                {busy === "save" && <Loader2 size={14} className="space-spin" />}
                {state.cloudId ? "Save changes" : "Save this model"}
              </button>
              <div className="acct-label">Your models</div>
              {models.length === 0 ? (
                <div className="acct-muted">Nothing saved yet.</div>
              ) : (
                <ul className="acct-list">
                  {models.map((m) => (
                    <li key={m.id} className={m.id === state.cloudId ? "on" : undefined}>
                      <button className="acct-item" onClick={() => load(m.id)} disabled={busy !== null}>
                        <span>{m.title}</span>
                        <small>{busy === `load:${m.id}` ? "Opening…" : formatDate(m.updatedAt)}</small>
                      </button>
                      <button
                        className="acct-del"
                        onClick={() => remove(m)}
                        disabled={busy !== null}
                        aria-label={`Delete ${m.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <form className="acct-form" onSubmit={submitAuth}>
              <div className="acct-title">{mode === "login" ? "Sign in" : "Create account"}</div>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="acct-primary" type="submit" disabled={busy !== null}>
                {busy === "auth" && <Loader2 size={14} className="space-spin" />}
                {mode === "login" ? "Sign in" : "Create account"}
              </button>
              <button
                type="button"
                className="acct-link"
                onClick={() => {
                  setMode((m) => (m === "login" ? "signup" : "login"));
                  setError(null);
                }}
              >
                {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
              </button>
            </form>
          )}
          {error && <div className="acct-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
