// Public entry point for the AI chat agent: the shared per-round loop (tool execution, abort
// handling, round budget), plus backend selection between the OpenAI-compatible protocol
// (default — OpenAI itself, DeepSeek, OpenRouter, local servers, ...) and Gemini's own native SDK
// (required for Gemini specifically — see geminiBackend.ts's header for why). Everything
// provider-shaped lives in one of the two backend files; this file only orchestrates.

import type { Model } from "@vensim-ai/core";
import { openaiBackend, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./openaiBackend.js";
import { geminiBackend, GEMINI_DEFAULT_MODEL } from "./geminiBackend.js";
import { defaultToolExecutor, type ToolExecutor } from "./tools.js";
import type { ToolCallResult } from "./types.js";
import type { AgentBackend, AgentCallbacks, AgentConnection, AgentSession, StreamedRound } from "./types.js";

export { createAgentSession } from "./types.js";
export type { AgentSession, AgentConnection, AgentCallbacks } from "./types.js";
export { DEFAULT_BASE_URL, DEFAULT_MODEL };

/** Picks the backend by base URL rather than model name — a Gemini API key/model can still be
 * pointed at a non-default `baseUrl` (e.g. a proxy), but the one thing that never changes is that
 * only Google's own endpoint speaks Gemini's native protocol; everything else on the internet
 * calling itself OpenAI-compatible actually is. */
function backendFor(connection: AgentConnection): AgentBackend {
  const baseUrl = connection.baseUrl || DEFAULT_BASE_URL;
  if (baseUrl.includes("generativelanguage.googleapis.com")) return geminiBackend;
  return openaiBackend;
}

/** The default model to fall back to when a connection profile has none set — backend-specific,
 * since "gpt-4o" means nothing to Gemini's endpoint and vice versa. */
export function defaultModelFor(baseUrl: string): string {
  return baseUrl.includes("generativelanguage.googleapis.com") ? GEMINI_DEFAULT_MODEL : DEFAULT_MODEL;
}

/**
 * A connection that fails partway through a turn is the single most common way a long agent run
 * dies, and it is always worth another attempt: the round is atomic (see AgentBackend.streamRound),
 * so a failed one wrote nothing anywhere, and re-sending the same request is exactly what the user
 * would otherwise do by hand.
 *
 * Classification has to be message-based rather than class-based, because the openai SDK rethrows
 * whatever `fetch` threw, unwrapped — there is no shared error class to match on. The browser's
 * word for it depends on where the connection died: "Failed to fetch" when it never got
 * established at all (DNS, refused, CORS preflight), "network error" when the response body's
 * stream errored mid-flight (which is what a provider dropping a long streamed reply looks like),
 * "Load failed" on WebKit, "fetch failed"/"terminated"/"other side closed" under undici.
 */
const NETWORK_FAILURE_MESSAGES = new Set([
  "failed to fetch",
  "network error",
  "load failed",
  "fetch failed",
  "terminated",
  "other side closed",
  "socket hang up",
  "connection error.",
  "request timed out.",
]);
/** Checked against `code`, `cause.code` AND the message text, because the same failure reports it
 * in different places depending on runtime: Bun's fetch raises a TypeError whose message is prose
 * ("The socket connection was closed unexpectedly…") with `code: "ECONNRESET"` on the side, while
 * undici puts "other side closed" in the message and `UND_ERR_SOCKET` in the cause. */
const NETWORK_FAILURE_CODES = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR/i;
/** HTTP statuses the provider itself is telling us are temporary — rate limits and lock/timeout
 * conditions. The SDK retries these twice on its own before giving up; these are the attempts
 * after that, with a longer backoff, since a rate limit that survived two retries needs real time
 * rather than a few hundred milliseconds. */
const RETRIABLE_STATUSES = new Set([408, 409, 425, 429]);

/** `signal` is the CALLER's abort signal (the Stop button), not the SDK's internal request
 * timeout — the two both surface as an AbortError but mean opposite things. A caller abort is
 * already returned as "aborted" by each backend before it can reach here, so an AbortError that
 * does arrive is the SDK's own timeout and is worth retrying. */
export function isRetriableConnectionError(err: unknown, signal?: AbortSignal): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return !signal?.aborted;
  // Whatever HTTP status the provider returned is authoritative when there is one — a 401 or a
  // 400 with a malformed-request body fails identically forever, and retrying it just delays the
  // error the user needs to see.
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") return RETRIABLE_STATUSES.has(status) || status >= 500;

  const message = err.message.toLowerCase();
  if (NETWORK_FAILURE_MESSAGES.has(message)) return true;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_FAILURE_CODES.test(code)) return true;
  if (NETWORK_FAILURE_CODES.test(err.message)) return true;

  // The wrapper's own text is often just "Connection error." while the detail that identifies the
  // failure sits on the cause — check it too, one level down, which is as deep as these go.
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    if (NETWORK_FAILURE_MESSAGES.has(cause.message.toLowerCase())) return true;
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string" && NETWORK_FAILURE_CODES.test(causeCode)) return true;
    if (NETWORK_FAILURE_CODES.test(cause.message)) return true;
  }
  // Last resort: the SDK's own connection-error classes, matched by name since they're the only
  // signal left if a future version words the message differently. (Note `err.name` on these is
  // plain "Error" in some runtimes — the constructor name is the reliable one.)
  return err.constructor?.name === "APIConnectionError" || err.constructor?.name === "APIConnectionTimeoutError";
}

/** How many times one round is attempted in total, and how long to wait before each retry after
 * the first failure. Deliberately short: this is an interactive editor, and a user watching a
 * spinner would rather see a clear error than wait out a long exponential ramp. */
export const ROUND_RETRY_ATTEMPTS = 3;
export const ROUND_RETRY_DELAYS_MS = [1000, 3000];

/** A sleep that a Stop button can cut short — without this, aborting during a retry delay would
 * leave the UI frozen for the rest of the backoff with no way to cancel. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** One round, retried on transient connection failures. Each attempt gets its OWN stream id: the
 * failed attempt's partial text must never be appended to (that would splice two half-replies
 * together into a message the model never produced) — the UI is told to discard it instead, and
 * the retry renders a fresh bubble in its place. */
async function streamRoundWithRetry(
  backend: AgentBackend,
  connection: AgentConnection,
  session: AgentSession,
  callbacks: AgentCallbacks,
  signal: AbortSignal | undefined,
  { maxAttempts, delaysMs }: { maxAttempts: number; delaysMs: number[] },
): Promise<StreamedRound | "aborted"> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await backend.streamRound(connection, session, callbacks, signal, crypto.randomUUID());
    } catch (err) {
      // A user-initiated Stop can surface as a thrown error too (rather than the backends' own
      // "aborted" return) — that's never something to retry.
      if (signal?.aborted) return "aborted";
      if (attempt >= maxAttempts || !isRetriableConnectionError(err, signal)) throw err;
      const delayMs = delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1] ?? 0;
      callbacks.onRoundRetry?.(attempt, maxAttempts, err, delayMs);
      await sleep(delayMs, signal);
      if (signal?.aborted) return "aborted";
    }
  }
}

/**
 * Everything about a turn that isn't the conversation itself. Grouped rather than positional
 * because there are now four of them and the list had grown past the point where a caller could
 * tell `runAgentTurn(a, b, c, d, e, 40, signal, retry, execute)` apart at the call site.
 */
export interface AgentRunOptions {
  /** Each round is one full model response, which can itself batch multiple tool calls — but a
   * model that calls tools one at a time (common) only makes one call of progress per round, and
   * a modest diagram (several stocks/flows plus their connectors) can easily need more than a
   * handful of individual tool calls. The cap exists purely as a runaway-loop safety net.
   * Default 40. */
  maxToolRounds?: number;
  /** Checked between rounds and between individual tool executions (not just passed to the network
   * call) — a long tool loop with no in-flight network request at all still needs to be
   * interruptible mid-round, not just while actually waiting on the model. */
  signal?: AbortSignal;
  /** Overridable so tests don't have to sit through real backoff; production callers use the
   * defaults. See ROUND_RETRY_ATTEMPTS/DELAYS_MS for why these are as short as they are. */
  retry?: { maxAttempts: number; delaysMs: number[] };
  /** How a tool call actually runs — the host supplies one so `run_python` can go through
   * whatever interpreter it has (Pyodide in the app, a local `python3` in the CLI), or none at
   * all. See tools.ts. */
  executeToolCall?: ToolExecutor;
}

export async function runAgentTurn(
  connection: AgentConnection,
  session: AgentSession,
  userText: string,
  // A getter, not a fixed object: each tool call must mutate whatever is *currently* the store's
  // live model, not a snapshot taken once at the top of the turn. If the caller replaces the
  // model reference between tool calls (e.g. to clone-and-commit for a live canvas update after
  // each one, as the chat panel does), a fixed reference would mutate an orphaned object after
  // the first commit and every subsequent tool call would silently be lost.
  getModel: () => Model,
  callbacks: AgentCallbacks = {},
  {
    maxToolRounds = 40,
    signal,
    retry = { maxAttempts: ROUND_RETRY_ATTEMPTS, delaysMs: ROUND_RETRY_DELAYS_MS },
    executeToolCall = defaultToolExecutor,
  }: AgentRunOptions = {},
): Promise<void> {
  const backend = backendFor(connection);

  const summarized = await backend.summarizeHistoryIfNeeded(connection, session);
  if (summarized !== null) callbacks.onHistorySummarized?.(summarized);

  backend.appendUserMessage(session, userText);

  for (let round = 0; round < maxToolRounds; round++) {
    if (signal?.aborted) {
      callbacks.onAborted?.();
      return;
    }

    const result = await streamRoundWithRetry(backend, connection, session, callbacks, signal, retry);
    if (result === "aborted") {
      callbacks.onAborted?.();
      return;
    }

    if (result.toolCalls.length === 0) return; // nothing left to execute — the model is done this turn

    const toolResults: { id: string; name: string; content: string }[] = [];
    for (const call of result.toolCalls) {
      if (signal?.aborted) {
        // Every tool call in the round just streamed MUST get a matching result appended, or the
        // next request (this turn's retry, or a future one reusing this session) fails outright
        // with a protocol error — so a call skipped by an abort still gets a placeholder result
        // rather than being left dangling.
        toolResults.push({ id: call.id, name: call.name, content: JSON.stringify({ error: "Cancelled by user." }) });
        continue;
      }
      const callResult = await runTool(executeToolCall, getModel, call);
      callbacks.onToolCall?.(call.name, call.args, callResult);
      toolResults.push({
        id: call.id,
        name: call.name,
        content: JSON.stringify(callResult.ok ? callResult.result : { error: callResult.error }),
      });
    }
    backend.appendToolResults(session, toolResults);

    if (signal?.aborted) {
      callbacks.onAborted?.();
      return;
    }
  }

  // Only reachable if every one of maxToolRounds iterations still had tool calls queued up — every
  // other path above returns from inside the loop. The model was actively mid-task, not finished,
  // so this must be surfaced rather than left to look like a normal, silent finish.
  callbacks.onStoppedEarly?.("max_tool_rounds", maxToolRounds);
}

/**
 * Runs a tool call, turning a throw into a failed *tool call* rather than a dead turn.
 *
 * Tools describe what a model can do to a model diagram, and some of them can genuinely throw:
 * `run_python` simulates the model before handing it over, so it throws on a model that doesn't
 * compile — which is precisely the state a model is in the moment after an equation is typed
 * wrong, and precisely when the agent needs to be told so it can fix it. A crashed turn reports
 * nothing and leaves the user to guess; a tool result saying what broke is the same information
 * in the one place the model will actually read it.
 */
async function runTool(
  executeToolCall: ToolExecutor,
  getModel: () => Model,
  call: { name: string; args: Record<string, unknown> },
): Promise<ToolCallResult> {
  try {
    return await executeToolCall(getModel, call.name, call.args);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
