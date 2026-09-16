/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { totalTokens } from "./generate/generateClient";
import type { ChatMessage } from "./state/types";

/** The active chat's conversation, docked above the prompt bar. */
export function Thread({
  messages,
  busy,
  expandReasoning,
}: {
  messages: ChatMessage[];
  busy: boolean;
  expandReasoning: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Stay pinned to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  return (
    <div className="thread" ref={listRef} role="log" aria-live="polite">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="msg-user">
            {m.text}
          </div>
        ) : (
          <div key={m.id} className={"msg-ai" + (m.kind === "error" ? " msg-error" : "")}>
            <AssistantMessage message={m} expandReasoning={expandReasoning} />
          </div>
        ),
      )}
      {busy && (
        <div className="msg-ai msg-pending">
          <Loader2 size={13} className="space-spin" /> Thinking…
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ message: m, expandReasoning }: { message: ChatMessage; expandReasoning: boolean }) {
  const [showReasoning, setShowReasoning] = useState(expandReasoning);
  useEffect(() => setShowReasoning(expandReasoning), [expandReasoning]);

  return (
    <>
      <div>{m.text}</div>
      {(m.usage || m.kind === "tweak" || m.reasoning) && (
        <div className="msg-meta">
          {m.usage && (
            <span>
              {totalTokens(m.usage).toLocaleString()} tokens · {(m.usage.ms / 1000).toFixed(1)}s
            </span>
          )}
          {m.kind === "tweak" && <span>instant · no AI tokens</span>}
          {m.reasoning && (
            <button
              className="msg-reason-btn"
              onClick={() => setShowReasoning((v) => !v)}
              aria-expanded={showReasoning}
            >
              <Brain size={12} />
              {showReasoning ? "Hide reasoning" : "Show reasoning"}
            </button>
          )}
        </div>
      )}
      {showReasoning && m.reasoning && <div className="msg-reasoning">{m.reasoning}</div>}
    </>
  );
}
