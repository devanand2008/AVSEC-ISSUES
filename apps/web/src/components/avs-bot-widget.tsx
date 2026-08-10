"use client";

import { Bot, Send, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { authenticatedStream, ApiError, idempotencyKey } from "@/lib/api";

interface BotMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  status: "STREAMING" | "COMPLETED" | "FAILED" | "CANCELLED";
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export function AvsBotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [retryMessage, setRetryMessage] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (isOpen) {
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isOpen]);

  useEffect(() => () => controller.current?.abort(), []);

  async function send(message = draft) {
    const value = message.trim();
    if (!value || controller.current) return;
    setDraft("");
    setError(undefined);
    setRetryMessage(undefined);
    const userId = idempotencyKey();
    const assistantId = `pending-${userId}`;
    setMessages((current) => [
      ...current,
      { id: userId, role: "USER", content: value, status: "COMPLETED" },
      { id: assistantId, role: "ASSISTANT", content: "", status: "STREAMING" },
    ]);
    const abort = new AbortController();
    controller.current = abort;
    setStreaming(true);
    try {
      const response = await authenticatedStream(
        "/ai/chat/stream",
        {
          conversationId,
          message: value,
          clientRequestId: userId,
        },
        abort.signal,
      );
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => undefined)) as
          | { message?: string; error?: { message?: string } }
          | undefined;
        throw new ApiError(
          body?.error?.message ??
            body?.message ??
            "AVS Bot is temporarily unavailable.",
          response.status,
        );
      }
      await readSse(response.body, (item) => {
        if (item.event === "conversation") {
          setConversationId(String(item.data.id));
        } else if (item.event === "delta") {
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId
                ? {
                    ...entry,
                    content: entry.content + String(item.data.delta ?? ""),
                  }
                : entry,
            ),
          );
        } else if (item.event === "replace") {
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId
                ? {
                    ...entry,
                    id: String(item.data.messageId ?? entry.id),
                    content: String(item.data.content ?? ""),
                  }
                : entry,
            ),
          );
        } else if (item.event === "message" && item.data.role === "ASSISTANT") {
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId
                ? { ...entry, id: String(item.data.id ?? entry.id) }
                : entry,
            ),
          );
        } else if (item.event === "done") {
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId ||
              entry.id === String(item.data.messageId)
                ? {
                    ...entry,
                    id: String(item.data.messageId ?? entry.id),
                    status: "COMPLETED",
                  }
                : entry,
            ),
          );
        } else if (item.event === "error") {
          throw new Error(
            String(item.data.message ?? "AVS Bot could not answer."),
          );
        }
      });
    } catch (caught) {
      const cancelled =
        abort.signal.aborted ||
        (caught instanceof DOMException && caught.name === "AbortError");
      const failureMessage = cancelled
        ? "Response cancelled."
        : caught instanceof Error
          ? caught.message
          : "AVS Bot is temporarily unavailable.";
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId || entry.status === "STREAMING"
            ? {
                ...entry,
                content: entry.content || failureMessage,
                status: cancelled ? "CANCELLED" : "FAILED",
              }
            : entry,
        ),
      );
      if (!cancelled) {
        setError(failureMessage);
        setRetryMessage(value);
      }
    } finally {
      controller.current = null;
      setStreaming(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send();
  }
  
  return (
    <div className="avs-bot-widget">
      {!isOpen && (
        <button
          className="btn btn-primary avs-bot-launcher"
          onClick={() => setIsOpen(true)}
          aria-label="Open AVS Bot"
        >
          <Bot size={28} />
        </button>
      )}
      {isOpen && (
        <div className="card avs-bot-panel" style={{ display: "flex", flexDirection: "column", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", overflow: "hidden", padding: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "var(--primary)", color: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <Bot size={20} /> AVS Bot
            </div>
            <button
              className="avs-bot-close"
              aria-label="Close AVS Bot"
              style={{
                background: "none",
                border: "none",
                color: "white",
                cursor: "pointer",
                padding: 4,
              }}
              onClick={() => setIsOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <div style={{ flex: 1, padding: 16, overflowY: "auto", background: "#f8fafc", display: "flex", flexDirection: "column", gap: 12 }}>
            {!messages.length && (
              <div style={{ textAlign: "center", margin: "auto 0", padding: 16 }}>
                <Bot size={32} style={{ margin: "0 auto 8px", color: "var(--primary)" }} />
                <p style={{ fontWeight: 600, margin: "0 0 4px" }}>How can AVS Bot help?</p>
                <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>Ask about authorized college information.</p>
              </div>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                style={{
                  alignSelf: message.role === "USER" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  padding: "10px 12px",
                  borderRadius: 14,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontSize: "0.9rem",
                  background: message.role === "USER" ? "#dbeafe" : "#ffffff",
                  border: `1px solid ${message.status === "FAILED" ? "#dc2626" : "#dbe3ef"}`,
                }}
              >
                <strong>{message.role === "USER" ? "You" : "AVS Bot"}</strong>
                <p style={{ margin: "4px 0 0" }}>
                  {message.content ||
                    (message.status === "STREAMING"
                      ? "Thinking…"
                      : "No response was produced.")}
                </p>
                {message.status !== "COMPLETED" && (
                  <small className="muted" style={{ fontSize: "0.75rem", display: "block", marginTop: 4 }}>{message.status.toLowerCase()}</small>
                )}
              </article>
            ))}
            {error && <div className="error-box" role="alert" style={{ fontSize: "0.85rem" }}>{error}{retryMessage && <button type="button" className="btn btn-secondary" onClick={() => void send(retryMessage)} style={{ marginLeft: 8 }}>Retry</button>}</div>}
            <div ref={end} />
          </div>
          <form onSubmit={submit} style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8, background: "white" }}>
            <input 
              type="text" 
              className="input" 
              placeholder="Ask AVS Bot..." 
              style={{ flex: 1 }} 
              value={draft}
              disabled={streaming}
              onChange={(e) => setDraft(e.target.value)}
            />
            {streaming ? (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => controller.current?.abort()}
                style={{ padding: "0 12px" }}
              >
                <X size={16} />
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" style={{ padding: "0 12px" }} disabled={!draft.trim()}>
                <Send size={16} />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

async function readSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length)
        onEvent({
          event,
          data: JSON.parse(data.join("\n")) as Record<string, unknown>,
        });
    }
    if (done) break;
  }
}
