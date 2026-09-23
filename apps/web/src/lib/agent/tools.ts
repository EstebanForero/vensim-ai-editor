// Provider-agnostic tool definitions and execution — shared by every backend, each of which
// translates this one neutral `{name, description, parameters}` shape into its own protocol's
// tool-declaration format (OpenAI: `{type:"function", function:{...}}`; Gemini:
// `{functionDeclarations:[{name, description, parametersJsonSchema}]}`) rather than each backend
// (or worse, each provider) maintaining its own copy of what tools exist.

import { allVariables, simulate, type Model } from "@vensim-ai/core";
import { executeTool, VENSIM_AI_TOOLS } from "@vensim-ai/ai-tools";
import { runPython } from "../pyodide.js";
import type { ToolCallResult } from "./types.js";

export const SYSTEM_PROMPT = `You are an assistant embedded in a system-dynamics (Vensim-style) stock-and-flow / causal-loop
diagram editor. You edit the model exclusively through the provided tools — never by describing changes in prose
only. Conventions: Stocks (Levels) accumulate via Flows (Rates); Auxiliaries are computed variables; Constants are
auxiliaries with a fixed value; Relations (a.k.a. connectors) are signed causal arrows — set their polarity ("+" or
"-") accurately, since it drives automatic Reinforcing/Balancing feedback-loop detection. A pure causal-loop diagram
can be built with add_auxiliary + add_relation alone, no stocks or flows required. Use add_relation to link a
variable to any other variable whose equation references it, so the diagram stays legible and loops can be found.
Call list_model if you need to see current state, list_loops after wiring up relations to check what feedback loops
you've created, and run_simulation after building or changing equations to sanity-check behavior. Keep equations in
Vensim syntax (e.g. "Population * Birth Rate", "IF THEN ELSE(x > 10, 1, 0)"). Time is Vensim's built-in
clock and is already available in any equation — never create a variable for it, and never add it to the model.
Its units are the model's own time unit, so a bare coefficient multiplying it is usually a units error Vensim's
own Units Check will catch: in "5 + 0.15 * Time" the 0.15 is dimensionless, making the whole right-hand side
come out in months rather than the declared units. Either give the coefficient explicit units so it works out
(e.g. a per-month-per-month growth rate, or a slope variable declared with the right units), or don't scale by
Time at all. For a relationship that isn't a formula —
a non-linear effect read off a graph, or a table the exercise states outright — build a lookup table with set_lookup
and call it from other equations as Name(input): an exercise giving "max X and Y value, min X and Y value" plus an
input/output table is asking for exactly that. Never reference a lookup table bare as if it were a number, and set its
units to what the curve RETURNS. Use add_comment for freestanding notes
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

export interface NeutralTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// Not part of @vensim-ai/ai-tools (packages/core's model-mutation tools, portable/synchronous
// JS) since this one runs a real Python interpreter client-side via Pyodide — a browser-only,
// async capability with nothing to do with the model-mutation API surface.
const RUN_PYTHON_TOOL: NeutralTool = {
  name: "run_python",
  description:
    "Runs Python code in a real (client-side, sandboxed, nothing leaves the browser) interpreter to numerically validate the model's behavior — e.g. checking a stock's trajectory is monotonic where it should be, staying within an expected range, converging to a sensible equilibrium, or matching a hand-computed value. Two globals are pre-populated before your code runs: `sim` (the FULL-precision simulation result — `sim['time']` is a list of every timestep, `sim['series']` maps each variable's exact name to its full list of values, not the downsampled-to-50-points version run_simulation returns for readability) and `model` (a list of every stock/flow/auxiliary as `{name, kind, equation, units}`). Print whatever you want to see — stdout is returned to you. Use this after run_simulation to actually check the result is right, not just skim the final values; system dynamics equations are easy to get subtly wrong (a sign flipped, a rate misapplied) in ways that still \"run\" without error.",
  parameters: {
    type: "object",
    properties: { code: { type: "string", description: "Python source to execute." } },
    required: ["code"],
  },
};

export const NEUTRAL_TOOLS: NeutralTool[] = [
  ...VENSIM_AI_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
  RUN_PYTHON_TOOL,
];

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

async function runPythonTool(code: string, model: Model): Promise<ToolCallResult> {
  const run = await runPython(code, pythonGlobals(model));
  // stdout is worth returning either way (a failing check's prints, or a traceback's context up
  // to the point it failed), not just on success.
  if (run.ok) return { ok: true, result: { stdout: run.stdout } };
  return { ok: false, error: run.stdout ? `${run.error}\n\nstdout so far:\n${run.stdout}` : (run.error ?? "Unknown error") };
}

/** Executes one tool call by name, dispatching run_python to Pyodide and everything else to
 * @vensim-ai/ai-tools' synchronous model-mutation executor. The one place both backends route
 * a parsed tool call through, so neither duplicates this dispatch logic. */
export async function executeToolCall(getModel: () => Model, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  if (name === "run_python") {
    return runPythonTool(typeof args.code === "string" ? args.code : "", getModel());
  }
  return executeTool(getModel(), name, args);
}
