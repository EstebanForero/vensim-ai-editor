import { allVariables, simulate, type Model } from "@vensim-ai/core";
import { executeTool, VENSIM_AI_TOOLS } from "@vensim-ai/ai-tools";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolMessageParam } from "openai/resources/chat/completions";
import { runPython } from "./pyodide.js";

/** Default endpoint for OpenAI itself. Any OpenAI-compatible server (Azure OpenAI's
 * OpenAI-compatible route, a local vLLM/Ollama/LM Studio server, OpenRouter, etc.) works too —
 * just point `baseUrl` at it. */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You are an assistant embedded in a system-dynamics (Vensim-style) stock-and-flow / causal-loop
diagram editor. You edit the model exclusively through the provided tools — never by describing changes in prose
only. Conventions: Stocks (Levels) accumulate via Flows (Rates); Auxiliaries are computed variables; Constants are
auxiliaries with a fixed value; Relations (a.k.a. connectors) are signed causal arrows — set their polarity ("+" or
"-") accurately, since it drives automatic Reinforcing/Balancing feedback-loop detection. A pure causal-loop diagram
can be built with add_auxiliary + add_relation alone, no stocks or flows required. Use add_relation to link a
variable to any other variable whose equation references it, so the diagram stays legible and loops can be found.
Call list_model if you need to see current state, list_loops after wiring up relations to check what feedback loops
you've created, and run_simulation after building or changing equations to sanity-check behavior. Keep equations in
Vensim syntax (e.g. "Population * Birth Rate", "IF THEN ELSE(x > 10, 1, 0)"). Use add_comment for freestanding notes
on the diagram (not equations), and set_sim_spec to change start/stop time, dt, or integration method when asked.
The model's time unit (set via set_sim_spec's time_units, always an English Vensim keyword like "Month" or "Year")
and a variable's OWN declared units are two different things, but any time-denominator word inside a units string
("resources/Month", "1/Year", ...) must use that exact same word — never translate it into whatever language the
rest of the model (variable names, other units words like "recursos" or "suscriptores") is in. Check what the
model's time unit actually is (list_model, or the set_sim_spec call you just made) before writing a rate's units,
rather than defaulting to translating "per month" into the model's own language out of habit — that's the single
most common mistake here, and check_units (below) exists partly to catch it if it still happens, not to be relied
on instead of getting it right the first time. Call auto_layout after building a new model from scratch, or after
adding several elements in one go, so nothing piles up or drifts out of view — it's cheap and always safe to call
again. Call check_units after building or
changing equations/units, the same way you'd call run_simulation — treat a reported mismatch as something to
actually resolve, not noise to ignore. Most mismatches are real bugs (a units field that's just wrong, a variable
that shouldn't be summed/multiplied with another the way the equation does) or a units-STRING inconsistency rather
than a real dimensional one — e.g. "Suscriptores" (a stock, plural) and "Costo de adquisicion por suscriptor" (an
aux, singular "suscriptor") are the same physical unit spelled two different ways, which the checker treats as
genuinely different units since it only matches text, not grammatical number — the actual fix there is just to
respell one to match the other, not to work around it. Only when a mismatch reflects a REAL, deliberate unit
conversion the model needs (not a spelling fix) should you introduce a new auxiliary as a conversion factor — keep
it named for what it converts (e.g. "Factor de conversion" or similar, not a vague placeholder), and give it real
units whenever the conversion has real ones; units of "1" (dimensionless) are for when the ratio genuinely has no
physical unit of its own, not a shortcut to silence the checker without thinking about what's actually being
converted. Prefer the cleaner fix (correcting a units field, fixing the equation, respelling a unit consistently)
over adding a variable whenever one exists. After building or changing equations, use run_python to actually check
the simulation behaves as intended — don't just glance at run_simulation's final values. Print whatever checks you
run (e.g. "stock stays non-negative: True", or a computed steady-state value next to what the equations imply it
should be) so it's visible you verified it, not just that you looked. This matters most for anything with a
feedback loop or a nonlinear term (MIN/MAX, IF THEN ELSE, a ratio) where a sign error or misapplied rate can still
run without any error and look plausible at a glance. After you finish making changes, reply with a short
plain-text summary of what you did, including what you verified and how.`;

// Not part of @vensim-ai/ai-tools (packages/core's model-mutation tools, portable/synchronous
// JS) since this one runs a real Python interpreter client-side via Pyodide — a browser-only,
// async capability with nothing to do with the model-mutation API surface. Defined and executed
// here instead, special-cased in the tool-dispatch loop below.
const RUN_PYTHON_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "run_python",
    description:
      "Runs Python code in a real (client-side, sandboxed, nothing leaves the browser) interpreter to numerically validate the model's behavior — e.g. checking a stock's trajectory is monotonic where it should be, staying within an expected range, converging to a sensible equilibrium, or matching a hand-computed value. Two globals are pre-populated before your code runs: `sim` (the FULL-precision simulation result — `sim['time']` is a list of every timestep, `sim['series']` maps each variable's exact name to its full list of values, not the downsampled-to-50-points version run_simulation returns for readability) and `model` (a list of every stock/flow/auxiliary as `{name, kind, equation, units}`). Print whatever you want to see — stdout is returned to you. Use this after run_simulation to actually check the result is right, not just skim the final values; system dynamics equations are easy to get subtly wrong (a sign flipped, a rate misapplied) in ways that still \"run\" without error.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "Python source to execute." } },
      required: ["code"],
    },
  },
};

const OPENAI_TOOLS: ChatCompletionTool[] = [
  ...VENSIM_AI_TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  })),
  RUN_PYTHON_TOOL,
];

async function runPythonTool(code: string, model: Model): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const run = await runPython(code, pythonGlobals(model));
  // stdout is worth returning either way (a failing check's prints, or a traceback's context up
  // to the point it failed), not just on success.
  if (run.ok) return { ok: true, result: { stdout: run.stdout } };
  return { ok: false, error: run.stdout ? `${run.error}\n\nstdout so far:\n${run.stdout}` : (run.error ?? "Unknown error") };
}

function pythonGlobals(model: Model) {
  const sim = simulate(model);
  return {
    sim: { time: sim.time, series: sim.series },
    model: allVariables(model).map((v) => ({
      name: v.name,
      kind: v.kind,
      equation: "equation" in v ? v.equation : v.initialEquation,
      units: v.units,
    })),
  };
}

export interface AgentCallbacks {
  onToolCall?: (name: string, input: Record<string, unknown>, result: { ok: boolean; result?: unknown; error?: string }) => void;
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
   * how many old messages got folded into the summary that replaced them. */
  onHistorySummarized?: (messagesSummarized: number) => void;
}

export interface AgentSession {
  history: ChatCompletionMessageParam[];
}

export function createAgentSession(): AgentSession {
  return { history: [] };
}

export interface AgentConnection {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Omitted (not just falsy) means "don't send a reasoning_effort field at all" — most models
   * don't support it, and some OpenAI-compatible servers reject an unrecognized field outright
   * rather than ignoring it. */
  reasoningEffort?: "low" | "medium" | "high";
}

/** Accumulates streamed tool-call deltas by their index within the response (the SDK/protocol's
 * own way of identifying which partial-call a given chunk belongs to, since `id`/`function.name`
 * each only arrive once, in the first chunk for that call). */
interface AccumulatingToolCall {
  id: string;
  name: string;
  arguments: string;
}

// Character-count heuristic, not an actual token count (no tokenizer bundled client-side for
// arbitrary providers) — conservative enough that even a dense-token language stays well under
// most models' context windows before this trips. Once history exceeds this, everything except
// the most recent SUMMARIZE_KEEP_RECENT messages gets folded into one summary message.
const SUMMARIZE_THRESHOLD_CHARS = 60_000;
const SUMMARIZE_KEEP_RECENT = 12;

/** Finds the latest "user" message at or before `beforeIndex` — a genuine conversation-turn
 * boundary, since a user message never appears mid-tool-call-sequence. Splitting anywhere else
 * (e.g. between an assistant's tool_calls and its matching tool results) would leave the older
 * half ending on a dangling tool_call with no result, or the newer half starting on an orphaned
 * tool result with no preceding tool_calls — either fails the next request outright with most
 * providers' strict validation. Returns -1 if there's no such boundary (nothing safe to split). */
function safeSplitIndex(history: ChatCompletionMessageParam[], beforeIndex: number): number {
  for (let i = Math.min(beforeIndex, history.length - 1); i >= 0; i--) {
    if (history[i]!.role === "user") return i;
  }
  return -1;
}

/** Compacts `session.history` in place when it's grown large enough to matter, replacing
 * everything before a safe split point with one summary message (an extra, non-streamed,
 * tool-free completion call asking the model to recap what happened) while leaving the most
 * recent exchanges verbatim — keeps a long-running conversation from re-sending its entire
 * history, and therefore paying for it, on every single turn. */
async function summarizeHistoryIfNeeded(
  client: OpenAI,
  connection: AgentConnection,
  session: AgentSession,
  callbacks: AgentCallbacks,
): Promise<void> {
  const size = session.history.reduce((n, m) => n + JSON.stringify(m).length, 0);
  if (size < SUMMARIZE_THRESHOLD_CHARS) return;

  const splitIndex = safeSplitIndex(session.history, session.history.length - SUMMARIZE_KEEP_RECENT);
  if (splitIndex <= 0) return; // nothing old enough (or no safe boundary) to fold away yet

  const older = session.history.slice(0, splitIndex);
  const recent = session.history.slice(splitIndex);

  let summaryText: string;
  try {
    const response = await client.chat.completions.create({
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
    // A failed summarization call must not break the actual turn the user is waiting on —
    // just skip compacting this time and try again once history has grown further.
    return;
  }

  session.history = [
    { role: "user", content: `[Summary of earlier conversation, to save tokens]\n${summaryText}` },
    { role: "assistant", content: "Understood — continuing from that context." },
    ...recent,
  ];
  callbacks.onHistorySummarized?.(older.length);
}

export async function runAgentTurn(
  connection: AgentConnection,
  session: AgentSession,
  userText: string,
  // A getter, not a fixed object: each tool call must mutate whatever is *currently* the
  // store's live model, not a snapshot taken once at the top of the turn. If the caller
  // replaces the model reference between tool calls (e.g. to clone-and-commit for a live
  // canvas update after each one, as the chat panel does), a fixed reference would mutate an
  // orphaned object after the first commit and every subsequent tool call would silently be
  // lost — the model would look right after tool #1 and never change again.
  getModel: () => Model,
  callbacks: AgentCallbacks = {},
  // Each round is one full model response, which can itself batch multiple tool calls — but a
  // model that calls tools one at a time (common) only makes one call of progress per round, and
  // a modest diagram (several stocks/flows plus their connectors) can easily need more than a
  // handful of individual tool calls. 8 was too easy to hit on an ordinary request, and hitting
  // it looked exactly like the assistant finishing normally (see onStoppedEarly below) — raised
  // to a much less limiting default; the cap still exists purely as a runaway-loop safety net.
  maxToolRounds = 40,
  // Checked between rounds and between individual tool executions (not just passed to the
  // network call) — a long tool loop with no in-flight network request at all still needs to be
  // interruptible mid-round, not just while actually waiting on the model.
  signal?: AbortSignal,
): Promise<void> {
  const client = new OpenAI({
    apiKey: connection.apiKey,
    baseURL: connection.baseUrl || DEFAULT_BASE_URL,
    dangerouslyAllowBrowser: true,
  });

  await summarizeHistoryIfNeeded(client, connection, session, callbacks);
  session.history.push({ role: "user", content: userText });

  for (let round = 0; round < maxToolRounds; round++) {
    if (signal?.aborted) {
      callbacks.onAborted?.();
      return;
    }

    const stream = await client.chat.completions.create(
      {
        model: connection.model || DEFAULT_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...session.history],
        tools: OPENAI_TOOLS,
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
    const streamId = crypto.randomUUID();
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
          const existing = toolCallsByIndex.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
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
      // nothing was pushed to history yet this round, so the session is left in a clean state
      // to resume from on the next message.
      if (err instanceof Error && err.name === "AbortError") {
        callbacks.onAborted?.();
        return;
      }
      throw err;
    }
    // Aborting the underlying fetch doesn't necessarily THROW inside `for await` — depending on
    // exactly when the cancellation lands, iteration can just end silently instead, leaving
    // `content`/`toolCallsByIndex` holding a partial response with nothing to signal it was cut
    // short. Checked explicitly here (not just relying on the catch above) so an abort is never
    // mistaken for the model naturally finishing early.
    if (signal?.aborted) {
      callbacks.onAborted?.();
      return;
    }

    if (content) callbacks.onAssistantText?.(content);

    const toolCalls = [...toolCallsByIndex.values()].filter((tc) => tc.id && tc.name);
    const message: ChatCompletionMessageParam = {
      role: "assistant",
      content: content || null,
      ...(toolCalls.length > 0
        ? { tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } })) }
        : {}),
    };
    session.history.push(message);

    if (toolCalls.length === 0) return; // nothing left to execute — the model is done this turn

    const toolMessages: ChatCompletionToolMessageParam[] = [];
    for (const call of toolCalls) {
      if (signal?.aborted) {
        // Every tool_call in the message just pushed to history MUST get a matching tool result
        // message, or the next request (this turn's retry, or a future one reusing this
        // session) fails outright with a protocol error — so a call skipped by an abort still
        // gets a placeholder result rather than being left dangling.
        toolMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Cancelled by user." }) });
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        // malformed JSON from the model — executeTool will reject missing/invalid fields below
      }
      const result =
        call.name === "run_python"
          ? await runPythonTool(typeof args.code === "string" ? args.code : "", getModel())
          : executeTool(getModel(), call.name, args);
      callbacks.onToolCall?.(call.name, args, result);
      toolMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result.ok ? result.result : { error: result.error }),
      });
    }
    session.history.push(...toolMessages);

    if (signal?.aborted) {
      callbacks.onAborted?.();
      return;
    }
  }

  // Only reachable if every one of maxToolRounds iterations still had tool calls queued up —
  // every other path above returns from inside the loop. The model was actively mid-task, not
  // finished, so this must be surfaced rather than left to look like a normal, silent finish.
  callbacks.onStoppedEarly?.("max_tool_rounds", maxToolRounds);
}
