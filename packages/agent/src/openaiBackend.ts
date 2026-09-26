// Backend for any OpenAI-compatible /chat/completions endpoint (OpenAI itself, DeepSeek,
// OpenRouter, Azure OpenAI, local vLLM/Ollama/LM Studio, ...) — NOT used for Gemini, which has
// its own native backend (geminiBackend.ts) specifically because Gemini's OpenAI-compatible
// endpoint has real, provider-specific gaps in a browser context (see that file's header).

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolMessageParam } from "openai/resources/chat/completions";
import { getProviderAdapter } from "./providerAdapters.js";

import type { AgentBackend, AgentCallbacks, AgentConnection, AgentSession, NeutralTool, RoundSetup, StreamedRound, ToolResultForHistory } from "./types.js";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o";

function openaiTools(tools: NeutralTool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function history(session: AgentSession): ChatCompletionMessageParam[] {
  return session.history as ChatCompletionMessageParam[];
}

function client(connection: AgentConnection): OpenAI {
  const baseUrl = connection.baseUrl || DEFAULT_BASE_URL;
  const adapter = getProviderAdapter(baseUrl);
  return new OpenAI({
    apiKey: connection.apiKey,
    baseURL: baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: adapter?.headerOverrides,
  });
}

/** Accumulates streamed tool-call deltas by their index within the response (the protocol's own
 * way of identifying which partial-call a given chunk belongs to, since `id`/`function.name`
 * each only arrive once, in the first chunk for that call).
 *
 * `extra`/`functionExtra` hold whatever OTHER properties a chunk carried beyond the plain OpenAI
 * schema (id/type/function.name/function.arguments) — deliberately never narrowed to a fixed
 * field list, since some OpenAI-compatible servers attach their own per-call metadata outside
 * that schema and a client that only reconstructs the 3 known fields would silently drop it. */
interface AccumulatingToolCall {
  id: string;
  name: string;
  arguments: string;
  extra: Record<string, unknown>;
  functionExtra: Record<string, unknown>;
}

const KNOWN_TOOL_CALL_KEYS = new Set(["index", "id", "type", "function"]);
const KNOWN_FUNCTION_KEYS = new Set(["name", "arguments"]);

function captureExtra(target: Record<string, unknown>, source: object, knownKeys: Set<string>): void {
  for (const [k, v] of Object.entries(source)) {
    if (!knownKeys.has(k)) target[k] = v;
  }
}

async function streamRound(
  connection: AgentConnection,
  session: AgentSession,
  callbacks: AgentCallbacks,
  signal: AbortSignal | undefined,
  streamId: string,
  setup: RoundSetup,
): Promise<StreamedRound | "aborted"> {
  const c = client(connection);
  const stream = await c.chat.completions.create(
    {
      model: connection.model || DEFAULT_MODEL,
      messages: [{ role: "system", content: setup.system }, ...history(session)],
      tools: openaiTools(setup.tools),
      tool_choice: "auto",
      stream: true,
      // Not in every provider's request schema (it's an OpenAI reasoning-model concept,
      // increasingly adopted elsewhere) — only sent when a profile actually opts in, since a
      // stricter server can reject an unrecognized field outright rather than ignore it.
      ...(connection.reasoningEffort ? { reasoning_effort: connection.reasoningEffort } : {}),
    },
    { signal },
  );

  let content = "";
  const toolCallsByIndex = new Map<number, AccumulatingToolCall>();
  const knownToolNames = new Set<string>();

  try {
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;
      if (delta?.content) {
        content += delta.content;
        callbacks.onAssistantTextDelta?.(streamId, delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const existing = toolCallsByIndex.get(tc.index) ?? { id: "", name: "", arguments: "", extra: {}, functionExtra: {} };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name += tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        captureExtra(existing.extra, tc, KNOWN_TOOL_CALL_KEYS);
        if (tc.function) captureExtra(existing.functionExtra, tc.function, KNOWN_FUNCTION_KEYS);
        toolCallsByIndex.set(tc.index, existing);
        // Fire once, as soon as the name is first complete enough to be non-empty and hasn't
        // been announced yet — arguments keep streaming in after this.
        if (existing.name && !knownToolNames.has(existing.id || String(tc.index))) {
          knownToolNames.add(existing.id || String(tc.index));
          callbacks.onToolCallStart?.(existing.name);
        }
      }
    }
  } catch (err) {
    // AbortError (fetch's own name for a cancelled request) means the user pressed Stop —
    // nothing was pushed to history yet this round, so the session is left in a clean state to
    // resume from on the next message.
    if (err instanceof Error && err.name === "AbortError") return "aborted";
    throw err;
  }
  // Aborting the underlying fetch doesn't necessarily THROW inside `for await` — depending on
  // exactly when the cancellation lands, iteration can just end silently instead, leaving
  // `content`/`toolCallsByIndex` holding a partial response with nothing to signal it was cut
  // short. Checked explicitly here (not just relying on the catch above) so an abort is never
  // mistaken for the model naturally finishing early.
  if (signal?.aborted) return "aborted";

  if (content) callbacks.onAssistantText?.(content);

  const accumulated = [...toolCallsByIndex.values()].filter((tc) => tc.id && tc.name);
  const message: ChatCompletionMessageParam = {
    role: "assistant",
    content: content || null,
    ...(accumulated.length > 0
      ? {
          // Re-embeds whatever extra fields a provider's response actually carried, in the same
          // position they arrived — `extra`/`functionExtra` spread first so the well-known
          // fields below always win if a provider ever duplicates one, though in practice
          // they're disjoint key sets.
          tool_calls: accumulated.map((tc) => ({
            ...tc.extra,
            id: tc.id,
            type: "function" as const,
            function: { ...tc.functionExtra, name: tc.name, arguments: tc.arguments },
          })),
        }
      : {}),
  };
  history(session).push(message);

  const toolCalls = accumulated.map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments || "{}");
    } catch {
      // malformed JSON from the model — executeToolCall rejects missing/invalid fields itself
    }
    return { id: tc.id, name: tc.name, args };
  });
  return { content, toolCalls };
}

function appendToolResults(session: AgentSession, results: ToolResultForHistory[]): void {
  const toolMessages: ChatCompletionToolMessageParam[] = results.map((r) => ({
    role: "tool",
    tool_call_id: r.id,
    content: r.content,
  }));
  history(session).push(...toolMessages);
}

// Character-count heuristic, not an actual token count (no tokenizer bundled client-side for
// arbitrary providers) — conservative enough that even a dense-token language stays well under
// most models' context windows before this trips. Once history exceeds this, everything except
// the most recent SUMMARIZE_KEEP_RECENT messages gets folded into one summary message.
const SUMMARIZE_THRESHOLD_CHARS = 60_000;
const SUMMARIZE_KEEP_RECENT = 12;

/** Finds the latest "user" message at or before `beforeIndex` — a genuine conversation-turn
 * boundary in the OpenAI message shape, since a user message never appears mid-tool-call-
 * sequence there. Splitting anywhere else (e.g. between an assistant's tool_calls and its
 * matching tool results) would leave the older half ending on a dangling tool_call with no
 * result, or the newer half starting on an orphaned tool result with no preceding tool_calls —
 * either fails the next request outright with most providers' strict validation. */
function safeSplitIndex(msgs: ChatCompletionMessageParam[], beforeIndex: number): number {
  for (let i = Math.min(beforeIndex, msgs.length - 1); i >= 0; i--) {
    if (msgs[i]!.role === "user") return i;
  }
  return -1;
}

async function summarizeHistoryIfNeeded(connection: AgentConnection, session: AgentSession): Promise<number | null> {
  const msgs = history(session);
  const size = msgs.reduce((n, m) => n + JSON.stringify(m).length, 0);
  if (size < SUMMARIZE_THRESHOLD_CHARS) return null;

  const splitIndex = safeSplitIndex(msgs, msgs.length - SUMMARIZE_KEEP_RECENT);
  if (splitIndex <= 0) return null; // nothing old enough (or no safe boundary) to fold away yet

  const older = msgs.slice(0, splitIndex);
  const recent = msgs.slice(splitIndex);

  let summaryText: string;
  try {
    const response = await client(connection).chat.completions.create({
      model: connection.model || DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Summarize this conversation between a user and an AI assistant building a system-dynamics (Vensim-style) model. Preserve: what the model currently contains (stocks/flows/auxiliaries/relations and their equations, at least by name), what decisions were made and why, and anything the user asked for that isn't done yet. Be concise — this replaces the full history to save tokens, not a transcript.",
        },
        ...older,
      ],
    });
    summaryText = response.choices[0]?.message?.content || "(no summary content returned)";
  } catch {
    // A failed summarization call must not break the actual turn the user is waiting on — just
    // skip compacting this time and try again once history has grown further.
    return null;
  }

  session.history = [
    { role: "user", content: `[Summary of earlier conversation, to save tokens]\n${summaryText}` } satisfies ChatCompletionMessageParam,
    { role: "assistant", content: "Understood — continuing from that context." } satisfies ChatCompletionMessageParam,
    ...recent,
  ];
  return older.length;
}

export const openaiBackend: AgentBackend = {
  appendUserMessage(session, text) {
    history(session).push({ role: "user", content: text });
  },
  streamRound,
  appendToolResults,
  summarizeHistoryIfNeeded,
};
