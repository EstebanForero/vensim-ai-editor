// Native Gemini backend, using Google's own `@google/genai` SDK instead of Gemini's
// OpenAI-compatible endpoint. Two real, provider-specific problems make the OpenAI-compatible
// path unusable for Gemini's thinking-enabled models in a browser:
//  1. CORS: the `openai` SDK's default `x-stainless-*` telemetry headers aren't allowed by
//     Gemini's OpenAI-compat CORS preflight, so the request never goes out.
//  2. Even past that, Gemini's thinking models require a `thoughtSignature` on every function-call
//     part, echoed back verbatim on the next request — the plain OpenAI `tool_calls` JSON schema
//     has no field for it, and (per multiple upstream reports) Gemini's own OpenAI-compat
//     translation layer drops it when generating the response in the first place, so no amount of
//     client-side round-tripping can recover it through that endpoint.
// The SDK's classic `generateContentStream` (NOT the newer "Interactions" API, which sets its own
// CORS-problematic `Api-Revision` header) avoids both: no extra headers, and Gemini's native
// `Content`/`Part` shape carries `thoughtSignature` directly.

import { GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import { NEUTRAL_TOOLS, SYSTEM_PROMPT } from "./tools.js";
import type { AgentBackend, AgentCallbacks, AgentConnection, AgentSession, StreamedRound, ToolResultForHistory } from "./types.js";

export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";

const GEMINI_TOOLS = [
  {
    functionDeclarations: NEUTRAL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.parameters,
    })),
  },
];

function history(session: AgentSession): Content[] {
  return session.history as Content[];
}

function client(connection: AgentConnection): GoogleGenAI {
  // `connection.baseUrl` is only used by agent.ts's backendFor() to ROUTE to this backend (it
  // just needs to contain "generativelanguage.googleapis.com" — including a leftover path from
  // this connection's old OpenAI-compat days, back when Gemini went through openaiBackend
  // instead). It's deliberately NOT forwarded into the SDK's own request path here: Gemini's
  // native REST shape (`/v1beta/models/{model}:streamGenerateContent`) is nothing like the
  // OpenAI-compat path a saved profile might still carry, so blindly reusing it as `httpOptions.
  // baseUrl` would send requests to the wrong path. There's exactly one real Gemini endpoint, so
  // the SDK's own built-in default is always correct here.
  return new GoogleGenAI({ apiKey: connection.apiKey });
}

// Gemini has no "reasoning_effort" string parameter — it uses a `thinkingConfig.thinkingLevel`
// enum instead. Mapped 1:1 from our shared low/medium/high UI control.
function thinkingLevel(effort: AgentConnection["reasoningEffort"]): ThinkingLevel | undefined {
  if (effort === "low") return ThinkingLevel.LOW;
  if (effort === "medium") return ThinkingLevel.MEDIUM;
  if (effort === "high") return ThinkingLevel.HIGH;
  return undefined;
}

async function streamRound(
  connection: AgentConnection,
  session: AgentSession,
  callbacks: AgentCallbacks,
  signal: AbortSignal | undefined,
  streamId: string,
): Promise<StreamedRound | "aborted"> {
  const level = thinkingLevel(connection.reasoningEffort);
  const stream = await client(connection).models.generateContentStream({
    model: connection.model || GEMINI_DEFAULT_MODEL,
    contents: history(session),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: GEMINI_TOOLS,
      abortSignal: signal,
      ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
    },
  });

  let content = "";
  // Parts are accumulated whole (not merged/deduped) and re-emitted verbatim into history,
  // preserving whatever `thoughtSignature` Gemini attached — the same "never drop unknown
  // provider metadata" principle as openaiBackend's captureExtra, but trivial here since the SDK's
  // own Part type already carries the field by name.
  const responseParts: Part[] = [];
  const knownToolNames = new Set<string>();

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) return "aborted";
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        responseParts.push(part);
        if (part.text && !part.thought) {
          content += part.text;
          callbacks.onAssistantTextDelta?.(streamId, part.text);
        }
        if (part.functionCall?.name) {
          const key = part.functionCall.id || part.functionCall.name;
          if (!knownToolNames.has(key)) {
            knownToolNames.add(key);
            callbacks.onToolCallStart?.(part.functionCall.name);
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "aborted";
    throw err;
  }
  if (signal?.aborted) return "aborted";

  if (content) callbacks.onAssistantText?.(content);

  history(session).push({ role: "model", parts: responseParts });

  // Gemini function calls don't always carry an `id` (only when explicitly non-blocking) — a
  // synthetic "local:" id lets appendToolResults tell a real Gemini id (echo it back, required
  // for matching) apart from one we made up (omit it — an id Gemini never issued means nothing to
  // it, and would just be extra unrecognized data on the functionResponse).
  const toolCalls = responseParts
    .filter((p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } => !!p.functionCall?.name)
    .map((p, i) => ({
      id: p.functionCall.id || `local:${streamId}-${i}`,
      name: p.functionCall.name!,
      args: p.functionCall.args ?? {},
    }));
  return { content, toolCalls };
}

function appendToolResults(session: AgentSession, results: ToolResultForHistory[]): void {
  const parts: Part[] = results.map((r) => ({
    functionResponse: {
      id: r.id.startsWith("local:") ? undefined : r.id,
      name: r.name,
      response: { output: r.content },
    },
  }));
  history(session).push({ role: "user", parts });
}

// Character-count heuristic, matching openaiBackend's — see that file for why it's not a real
// token count.
const SUMMARIZE_THRESHOLD_CHARS = 60_000;
const SUMMARIZE_KEEP_RECENT = 12;

/** Finds the latest safe split boundary — a `role: "model"` turn that has NO function calls
 * (i.e. a plain text reply), since only that shape reliably follows a genuine prior user message
 * rather than sitting in the middle of a call/response exchange. Unlike the OpenAI backend, a
 * `role: "user"` entry here can just as easily be a functionResponse turn as a real user message,
 * so it can't be used as the boundary marker the way OpenAI's can. */
function safeSplitIndex(msgs: Content[], beforeIndex: number): number {
  for (let i = Math.min(beforeIndex, msgs.length - 1); i >= 0; i--) {
    const msg = msgs[i]!;
    if (msg.role === "model" && (msg.parts ?? []).every((p) => !p.functionCall)) {
      // Split right after this plain-text model turn, at the user (or function-response) turn
      // that follows it — but only if that next entry is a genuine new user message, not a
      // functionResponse continuing this same exchange (which can't happen right after a
      // functionCall-free model turn, since nothing would be responding to a call).
      return i + 1;
    }
  }
  return -1;
}

async function summarizeHistoryIfNeeded(connection: AgentConnection, session: AgentSession): Promise<number | null> {
  const msgs = history(session);
  const size = msgs.reduce((n, m) => n + JSON.stringify(m).length, 0);
  if (size < SUMMARIZE_THRESHOLD_CHARS) return null;

  const splitIndex = safeSplitIndex(msgs, msgs.length - SUMMARIZE_KEEP_RECENT);
  if (splitIndex <= 0) return null;

  const older = msgs.slice(0, splitIndex);
  const recent = msgs.slice(splitIndex);

  let summaryText: string;
  try {
    const response = await client(connection).models.generateContent({
      model: connection.model || GEMINI_DEFAULT_MODEL,
      contents: older,
      config: {
        systemInstruction:
          "Summarize this conversation between a user and an AI assistant building a system-dynamics (Vensim-style) model. Preserve: what the model currently contains (stocks/flows/auxiliaries/relations and their equations, at least by name), what decisions were made and why, and anything the user asked for that isn't done yet. Be concise — this replaces the full history to save tokens, not a transcript.",
      },
    });
    summaryText = response.text || "(no summary content returned)";
  } catch {
    return null;
  }

  session.history = [
    { role: "user", parts: [{ text: `[Summary of earlier conversation, to save tokens]\n${summaryText}` }] } satisfies Content,
    { role: "model", parts: [{ text: "Understood — continuing from that context." }] } satisfies Content,
    ...recent,
  ];
  return older.length;
}

export const geminiBackend: AgentBackend = {
  appendUserMessage(session, text) {
    history(session).push({ role: "user", parts: [{ text }] });
  },
  streamRound,
  appendToolResults,
  summarizeHistoryIfNeeded,
};
