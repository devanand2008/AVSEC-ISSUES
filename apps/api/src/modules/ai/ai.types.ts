export interface AiSuggestedAction {
  label: string;
  route: string;
  kind: "open";
}

export interface AiSafeSource {
  documentId: string;
  title: string;
  category: string;
  version: string;
  publishedAt: Date | null;
  openRoute: string | null;
  excerpt: string;
}

export interface AiContextResult {
  intent: string;
  context: Record<string, unknown>;
  suggestedActions: AiSuggestedAction[];
}

export type AiProviderStreamEvent =
  | { type: "delta"; delta: string }
  | {
      type: "completed";
      responseId: string | null;
      inputTokens: number;
      outputTokens: number;
    };

export type AiSseEvent =
  | { event: "conversation"; data: Record<string, unknown> }
  | { event: "message"; data: Record<string, unknown> }
  | { event: "delta"; data: { messageId: string; delta: string } }
  | { event: "replace"; data: { messageId: string; content: string } }
  | { event: "sources"; data: { messageId: string; sources: unknown[] } }
  | { event: "done"; data: Record<string, unknown> }
  | { event: "error"; data: { code: string; message: string } };
