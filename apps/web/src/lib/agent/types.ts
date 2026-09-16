// Shared, provider-agnostic types for the AI chat agent loop. `AgentSession.history` is
// deliberately opaque (`unknown[]`) at this level — each backend (openaiBackend.ts,
// geminiBackend.ts) owns the actual shape of its own entries (OpenAI's ChatCompletionMessageParam
// vs Gemini's Content), casting internally. Nothing outside a backend should assume a shape for
// history entries; that's the whole point of the split — a provider whose native history format
// doesn't fit OpenAI's message shape (Gemini's function-call/response turns, notably) still gets
// a correct, backend-owned implementation instead of a lossy translation into someone else's
// schema (which is exactly what broke tool calling against Gemini's thinking models: OpenAI's
// tool_calls schema has no field for Gemini's required thought_signature at all).

export interface AgentSession {
  history: unknown[];
}

export function createAgentSession(): AgentSession {
  return { history: [] };
}

export interface AgentConnection {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Omitted (not just falsy) means "don't request a specific reasoning effort" — most models
   * don't support it, and some servers reject an unrecognized field outright rather than
   * ignoring it. */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface ToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface AgentCallbacks {
  onToolCall?: (name: string, input: Record<string, unknown>, result: ToolCallResult) => void;
  /** Fired as soon as a tool call's NAME is known (streamed in before its arguments finish, and
   * well before it actually runs) — lets the UI show "calling add_stock…" immediately instead of
   * going silent for however long that round's completion + execution takes. */
  onToolCallStart?: (name: string) => void;
  /** Fired once, with the complete text, when an assistant message finishes. */
  onAssistantText?: (text: string) => void;
  /** Fired as each chunk of an assistant message's text streams in, `id` stable for the whole
   * message so the UI can grow one live bubble instead of appending separate messages per
   * chunk. Always followed by exactly one onAssistantText call with the full text once the
   * message completes (unless the turn is aborted first). */
  onAssistantTextDelta?: (id: string, delta: string) => void;
  /** Fired when a turn stops WITHOUT the model itself deciding it was done (still had more tool
   * calls queued up) — currently only the tool-round cap. Without this, hitting the cap looked
   * identical to a normal finish: the "editing…" indicator just disappeared with no explanation,
   * which read as the assistant randomly giving up mid-edit. */
  onStoppedEarly?: (reason: "max_tool_rounds", roundsUsed: number) => void;
  /** Fired when `signal` aborts the turn (the user pressed Stop) — distinct from onStoppedEarly,
   * which is specifically about running out of tool-round budget, not a deliberate cancel. */
  onAborted?: () => void;
  /** Fired when the session's history was compacted before this turn — `messagesSummarized` is
   * how many old entries got folded into the summary that replaced them. */
  onHistorySummarized?: (messagesSummarized: number) => void;
}

/** One assistant turn's worth of streamed output: any text, plus any tool calls the model
 * queued up (already parsed into plain `args` objects — a backend is responsible for turning
 * whatever it streams, JSON-string arguments or a native structured-args field, into this same
 * shape). Backends append their own native representation of this turn into `session.history`
 * as part of producing it — `streamRound` isn't a pure function of the round's output alone. */
export interface StreamedRound {
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}

export interface ToolResultForHistory {
  id: string;
  name: string;
  content: string;
}

/**
 * Everything a specific provider protocol needs to implement to plug into the shared agent loop
 * (agent.ts) — one full request/response round, appending tool results, and history
 * summarization (which needs backend-specific knowledge of what a "safe" split point in its own
 * history shape looks like — see the file header).
 */
export interface AgentBackend {
  /** Appends the user's new message into `session.history` in this backend's native shape. */
  appendUserMessage(session: AgentSession, text: string): void;

  /** Streams one assistant turn for the CURRENT session.history, appending the assistant's own
   * turn (text and/or tool calls, in this backend's native shape) as it completes. Returns
   * "aborted" if `signal` fired during the round (nothing left half-appended in that case). */
  streamRound(
    connection: AgentConnection,
    session: AgentSession,
    callbacks: AgentCallbacks,
    signal: AbortSignal | undefined,
    streamId: string,
  ): Promise<StreamedRound | "aborted">;

  /** Appends this round's tool RESULTS into session.history, in this backend's native shape
   * (OpenAI: role:"tool" messages keyed by tool_call_id; Gemini: a user-role turn with
   * functionResponse parts). */
  appendToolResults(session: AgentSession, results: ToolResultForHistory[]): void;

  /** Compacts session.history in place if it's grown large enough to matter (see
   * SUMMARIZE_THRESHOLD_CHARS in each backend) — backend-owned because "where's a safe place to
   * split" depends entirely on the native history shape (a plain role:"user" boundary is safe
   * for OpenAI's shape, but NOT for Gemini's, where a role:"user" entry can just as easily be a
   * functionResponse turn instead of a real user message). Returns how many entries were folded
   * away, or null if nothing was compacted (history too small, or no safe split point yet). */
  summarizeHistoryIfNeeded(connection: AgentConnection, session: AgentSession): Promise<number | null>;
}
