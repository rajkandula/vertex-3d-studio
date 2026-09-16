/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, type FormEvent } from "react";
import { ArrowUp, Loader2, MessageSquare } from "lucide-react";
import { activeChat, useStudio } from "./state/studioStore";
import { useGenerate } from "./generate/useGenerate";
import { DotSpace } from "./DotSpace";
import { AccountPanel } from "../cloud/AccountPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ChatMenu } from "./ChatMenu";
import { Thread } from "./Thread";

export function StudioPage() {
  const { state, dispatch } = useStudio();
  const { run, hasModel } = useGenerate();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [threadOpen, setThreadOpen] = useState(true);
  const chat = activeChat(state);
  const showThread = threadOpen && (chat.messages.length > 0 || busy);

  // Undo / redo live on the keyboard only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
      } else if (key === "y") {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  // Status messages clear themselves once nothing is running; errors stay until the prompt is edited.
  useEffect(() => {
    if (!state.status || busy || failed) return;
    const t = setTimeout(() => dispatch({ type: "SET_STATUS", status: null }), 3500);
    return () => clearTimeout(t);
  }, [state.status, busy, failed, dispatch]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setFailed(false);
    setPrompt("");
    try {
      await run(text);
    } catch (err: any) {
      setFailed(true);
      setPrompt(text); // give the prompt back so it can be retried
      dispatch({ type: "SET_STATUS", status: err?.message || "Generation failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space">
      <DotSpace shape={state.shape} fitKey={state.fitRequest} view={state.view} />

      {state.shape.nodes.length > 0 && !state.view.dots && !state.view.mesh && !state.view.wireframe && (
        <div className="nothing-hint">Nothing to draw — turn on Dots, Mesh or Wireframe in Settings.</div>
      )}

      <div className="toolbar-left">
        <ChatMenu busy={busy} />
        <SettingsPanel />
      </div>
      <AccountPanel />

      <div className="dock">
        {showThread && <Thread messages={chat.messages} busy={busy} expandReasoning={state.view.reasoning} />}
        {state.status && !showThread && <div className={"space-status" + (failed ? " err" : "")}>{state.status}</div>}
        <form className="space-prompt" onSubmit={submit}>
          {chat.messages.length > 0 && (
            <button
              type="button"
              className="thread-toggle"
              onClick={() => setThreadOpen((o) => !o)}
              aria-label={threadOpen ? "Hide conversation" : "Show conversation"}
              aria-expanded={threadOpen}
            >
              <MessageSquare size={15} />
              <span>{chat.messages.length}</span>
            </button>
          )}
          <input
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setFailed(false);
            }}
            placeholder={hasModel ? "Change it, or describe something new…" : "Describe something to build…"}
            disabled={busy}
            autoFocus
          />
          <button type="submit" className="space-send" disabled={busy || !prompt.trim()} aria-label="Build">
            {busy ? <Loader2 size={17} className="space-spin" /> : <ArrowUp size={17} />}
          </button>
        </form>
      </div>
    </div>
  );
}
