// What was made, said in a few lines: the path, the elements, the feedback structure, and any
// archetype the model's loops match.
//
// Reading the result back through the same analysers the app reports with is the point — a
// generated file can be judged without opening it, and a model with no feedback in it says so here
// rather than looking like a finished diagram in a file browser.

import { allVariables, detectArchetypes, detectLoops, type Model } from "@vensim-ai/core";

/** How many variables of each kind, as the file's own contents — not as the tool calls that made
 * them, which is what a run's log would tell you and a different thing entirely. */
export interface ElementCounts {
  stocks: number;
  flows: number;
  auxiliaries: number;
  relations: number;
}

export function countsOf(model: Model): ElementCounts {
  return {
    stocks: model.stocks.length,
    flows: model.flows.length,
    auxiliaries: model.auxiliaries.length,
    relations: model.connectors.length,
  };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface SummaryInput {
  path: string;
  model: Model;
  seconds: number;
  stoppedEarly: boolean;
}

/** The lines printed after a run. Returned as an array so the shape is testable without capturing
 * stdout — the command is what decides to print them. */
export function summaryLines({ path, model, seconds, stoppedEarly }: SummaryInput): string[] {
  const counts = countsOf(model);
  const loops = detectLoops(model);
  const archetypes = [...new Set(detectArchetypes(model).map((m) => m.label))];
  return [
    path,
    `  ${plural(counts.stocks, "stock")}, ${plural(counts.flows, "flow")}, ${plural(counts.auxiliaries, "auxiliary")}, ${plural(counts.relations, "relation")}`,
    `  ${plural(loops.length, "feedback loop")}${loops.length ? ` (${loops.map((l) => `${l.polarity}${l.number}`).join(", ")})` : ""}`,
    ...(archetypes.length ? [`  archetypes: ${archetypes.join(", ")}`] : []),
    `  ${seconds.toFixed(1)}s${stoppedEarly ? " (stopped early)" : ""}`,
  ];
}

/** Whether anything was built at all — an agent that made no changes is a failed run, not an
 * empty file to write over whatever was there. */
export function isEmpty(model: Model): boolean {
  return allVariables(model).length === 0;
}
