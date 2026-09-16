// Public entry point for the AI chat agent: the shared per-round loop (tool execution, abort
// handling, round budget), plus backend selection between the OpenAI-compatible protocol
// (default — OpenAI itself, DeepSeek, OpenRouter, local servers, ...) and Gemini's own native SDK
// (required for Gemini specifically — see geminiBackend.ts's header for why). Everything
// provider-shaped lives in one of the two backend files; this file only orchestrates.

import type { Model } from "@vensim-ai/core";
import { openaiBackend, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./agent/openaiBackend.js";
import { geminiBackend, GEMINI_DEFAULT_MODEL } from "./agent/geminiBackend.js";
import { executeToolCall } from "./agent/tools.js";
import type { AgentBackend, AgentCallbacks, AgentConnection, AgentSession } from "./agent/types.js";

export { createAgentSession } from "./agent/types.js";
export type { AgentSession, AgentConnection, AgentCallbacks } from "./agent/types.js";
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
  // Each round is one full model response, which can itself batch multiple tool calls — but a
  // model that calls tools one at a time (common) only makes one call of progress per round, and
  // a modest diagram (several stocks/flows plus their connectors) can easily need more than a
  // handful of individual tool calls. The cap exists purely as a runaway-loop safety net.
  maxToolRounds = 40,
  // Checked between rounds and between individual tool executions (not just passed to the network
  // call) — a long tool loop with no in-flight network request at all still needs to be
  // interruptible mid-round, not just while actually waiting on the model.
  signal?: AbortSignal,
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

    const streamId = crypto.randomUUID();
    const result = await backend.streamRound(connection, session, callbacks, signal, streamId);
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
      const callResult = await executeToolCall(getModel, call.name, call.args);
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
