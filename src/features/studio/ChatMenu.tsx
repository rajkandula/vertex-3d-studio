/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { activeChat, useStudio } from "./state/studioStore";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Top-left dropdown: start a new chat or go back to an earlier one and keep editing its model. */
export function ChatMenu({ busy }: { busy: boolean }) {
  const { state, dispatch } = useStudio();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = activeChat(state);
  const chats = [...state.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

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

  return (
    <div className="chats-anchor" ref={rootRef}>
      <button className="chats-btn" onClick={() => setOpen((o) => !o)} aria-label="Chats" aria-expanded={open}>
        <MessagesSquare size={16} />
        <span>{current.title}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="chats-panel">
          <button
            className="acct-primary"
            disabled={busy}
            onClick={() => {
              dispatch({ type: "NEW_CHAT" });
              setOpen(false);
            }}
          >
            <Plus size={14} /> New chat
          </button>
          <div className="acct-label">Chats</div>
          <ul className="acct-list">
            {chats.map((c) => {
              const prompts = c.messages.filter((m) => m.role === "user").length;
              return (
                <li key={c.id} className={c.id === current.id ? "on" : undefined}>
                  <button
                    className="acct-item"
                    disabled={busy}
                    onClick={() => {
                      dispatch({ type: "OPEN_CHAT", id: c.id });
                      setOpen(false);
                    }}
                  >
                    <span>{c.title}</span>
                    <small>
                      {when(c.updatedAt)} · {prompts} {prompts === 1 ? "prompt" : "prompts"}
                    </small>
                  </button>
                  <button
                    className="acct-del"
                    disabled={busy}
                    aria-label={`Delete ${c.title}`}
                    onClick={() => {
                      if (window.confirm(`Delete the chat “${c.title}”? This can’t be undone.`)) {
                        dispatch({ type: "DELETE_CHAT", id: c.id });
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          {busy && <div className="acct-muted">Wait for the current build to finish to switch chats.</div>}
        </div>
      )}
    </div>
  );
}
