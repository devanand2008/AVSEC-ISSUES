"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Send, ShieldCheck, Square } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { authenticatedStream, api, ApiError, idempotencyKey } from "@/lib/api";

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

export default function AvsBotPage() {
  const suggestions = useQuery({
    queryKey: ["avs-bot-suggestions"],
    queryFn: () => api.get<{ questions: string[] }>("/ai/suggested-questions"),
  });
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => () => controller.current?.abort(), []);

  async function send(message = draft) {
    const value = message.trim();
    if (!value || controller.current) return;
    setDraft("");
    setError(undefined);
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
      if (!cancelled) setError(failureMessage);
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
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Secure, role-aware assistance</span>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            AVS Bot
          </h1>
          <p className="page-subtitle">
            Ask about authorised college information and application features.
          </p>
        </div>
      </div>
      <section
        className="card"
        style={{
          maxWidth: 960,
          margin: "0 auto",
          minHeight: "min(720px, calc(100vh - 190px))",
          display: "grid",
          gridTemplateRows: "auto minmax(320px, 1fr) auto",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 14,
            display: "flex",
            gap: 10,
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <ShieldCheck size={20} />
          <small>
            AVS Bot uses only information authorised for your account. Do not
            enter passwords, OTPs, API keys or banking details.
          </small>
        </div>
        <div
          aria-live="polite"
          style={{
            padding: 18,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            background: "#f8fafc",
          }}
        >
          {!messages.length && (
            <div className="empty">
              <Bot size={42} style={{ margin: "0 auto 12px" }} />
              <strong>How can AVS Bot help?</strong>
              <p>Choose a suggestion or write your own question.</p>
              <div className="button-row" style={{ justifyContent: "center" }}>
                {suggestions.data?.questions.map((question) => (
                  <button
                    className="btn btn-secondary"
                    key={question}
                    onClick={() => void send(question)}
                    type="button"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              style={{
                alignSelf: message.role === "USER" ? "flex-end" : "flex-start",
                maxWidth: "min(760px, 88%)",
                padding: "12px 14px",
                borderRadius: 14,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                background: message.role === "USER" ? "#dbeafe" : "#ffffff",
                border: `1px solid ${message.status === "FAILED" ? "#dc2626" : "#dbe3ef"}`,
              }}
            >
              <strong>{message.role === "USER" ? "You" : "AVS Bot"}</strong>
              <p style={{ margin: "6px 0 0" }}>
                {message.content ||
                  (message.status === "STREAMING"
                    ? "Thinking…"
                    : "No response was produced.")}
              </p>
              {message.status !== "COMPLETED" && (
                <small className="muted">{message.status.toLowerCase()}</small>
              )}
            </article>
          ))}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div ref={end} />
        </div>
        <form
          onSubmit={submit}
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 10,
            padding: 14,
            borderTop: "1px solid var(--border)",
          }}
        >
          <textarea
            className="input"
            aria-label="Ask AVS Bot"
            maxLength={8000}
            rows={2}
            value={draft}
            disabled={streaming}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask AVS Bot about authorised college information"
            style={{ flex: 1, resize: "vertical" }}
          />
          {streaming ? (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => controller.current?.abort()}
            >
              <Square size={17} /> Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!draft.trim()}
            >
              <Send size={17} /> Send
            </button>
          )}
        </form>
      </section>
    </>
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
