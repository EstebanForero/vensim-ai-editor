// Putting one fault into a model, and knowing exactly what it was.
//
// The "Find the mistakes" mode asks the agent to plant a fault and then to find it — the same
// reading of the same model doing both halves, with nothing checking that the fault it planted is
// findable or that the behaviour it claims is real. This does the planting the other way round: the
// app makes one change, keeps the answer, and *runs both* to confirm the change actually altered the
// model's behaviour. A fault that changes nothing is not a fault, and is rejected here rather than
// handed over as an exercise with no solution.
//
// Only faults that are unambiguous. Every one is a flow that no longer moves material the way it
// should — the most common real wiring mistake, and one the run always reveals. Faults that are
// merely *different* (a rate scaled up, a constant retuned) are deliberately absent: nothing defends
// them as wrong, so marking them would be marking a preference.
//
// The change goes through `setFlowEndpoint`, the same builder the canvas and the AI tools use, so a
// planted model is one the editor itself could have produced — never a hand-patched object that
// merely happens to simulate.

import { setFlowEndpoint } from "../model/builder/flow.js";
import { type Flow, type Model } from "../model/types.js";
import { simulate, type SimResult } from "../sim/engine.js";
import type { DrillQuestion } from "./types.js";

export type FaultKind = "reversed-flow" | "misdirected-flow";

export interface PlantedFault {
  /** The model with exactly one fault in it. */
  model: Model;
  /** The exercise, whose `answer` is the name of the variable at fault. */
  question: DrillQuestion;
  kind: FaultKind;
  /** The variable the fault is in. */
  variableId: string;
}

interface FaultCandidate {
  kind: FaultKind;
  flow: Flow;
  apply(model: Model): void;
}

function describe(model: Model, flow: Flow): string {
  const end = (id: string | null) => (id ? (model.stocks.find((s) => s.id === id)?.name ?? "?") : "outside the model");
  return `takes from ${end(flow.from)} and adds to ${end(flow.to)}`;
}

/**
 * Every one-change fault this model admits: reverse a flow, or point one of its ends at a different
 * stock. A flow with an end on a cloud can only be reversed; one between two stocks can also be
 * misdirected, but only to a stock it does not already touch — pointing it back at an end it
 * already has is not a change.
 *
 * `setFlowEndpoint` refuses a flow with both ends null, so every reversal sets the new end before
 * clearing the old one.
 */
function faultCandidates(base: Model): FaultCandidate[] {
  const out: FaultCandidate[] = [];
  const stocks = base.stocks;

  for (const flow of base.flows) {
    const { id, from, to } = flow;

    // Reverse. Three shapes, because a cloud end has to be moved rather than swapped.
    if (from && !to) {
      out.push({
        kind: "reversed-flow",
        flow,
        apply: (m) => {
          setFlowEndpoint(m, id, "to", from);
          setFlowEndpoint(m, id, "from", null);
        },
      });
    } else if (!from && to) {
      out.push({
        kind: "reversed-flow",
        flow,
        apply: (m) => {
          setFlowEndpoint(m, id, "from", to);
          setFlowEndpoint(m, id, "to", null);
        },
      });
    } else if (from && to) {
      // X → Y becomes Y → X. Setting `from` to Y first makes the flow a momentary Y → Y rather than
      // clearing it to a cloud, which the builder would refuse.
      out.push({
        kind: "reversed-flow",
        flow,
        apply: (m) => {
          setFlowEndpoint(m, id, "from", to);
          setFlowEndpoint(m, id, "to", from);
        },
      });
    }

    // Misdirect: the same one-end move, to a stock the flow is not already attached to.
    for (const stock of stocks) {
      if (stock.id === from || stock.id === to) continue;
      if (from) {
        out.push({
          kind: "misdirected-flow",
          flow,
          apply: (m) => setFlowEndpoint(m, id, "from", stock.id),
        });
      }
      if (to) {
        out.push({
          kind: "misdirected-flow",
          flow,
          apply: (m) => setFlowEndpoint(m, id, "to", stock.id),
        });
      }
    }
  }
  return out;
}

export function plantFault(base: Model, options: { seed?: number } = {}): PlantedFault | null {
  const before = trySimulate(base);
  // Without a working run there is no way to tell a fault from a harmless edit, so there is nothing
  // to plant. The caller falls back to a model that does run.
  if (!before) return null;

  const candidates = faultCandidates(base);
  if (candidates.length === 0) return null;

  const start = (((options.seed ?? 0) % candidates.length) + candidates.length) % candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[(start + i) % candidates.length]!;
    const model = structuredClone(base);
    try {
      candidate.apply(model);
    } catch {
      // A rewire the builder refuses (no stock left to attach to) is simply not a candidate.
      continue;
    }
    const after = trySimulate(model);
    if (!after || !behaviourChanged(before, after)) continue;

    const faulted = model.flows.find((f) => f.id === candidate.flow.id);
    const was = describe(base, candidate.flow);
    const now = faulted ? describe(model, faulted) : "was removed";

    return {
      model,
      kind: candidate.kind,
      variableId: candidate.flow.id,
      question: {
        id: `fault:${candidate.kind}:${candidate.flow.name}`,
        skill: "equations",
        prompt:
          "Exactly one thing was changed in this model, and it is now wrong. Which variable is the fault in?",
        kind: "short",
        answer: candidate.flow.name,
        source: "plantFault",
        explanation: `${candidate.flow.name} was rewired: it used to ${was}, and now it ${now}. Run the model and the difference shows in the stocks it touches — the one it used to feed now drains.`,
      },
    };
  }
  return null;
}

function trySimulate(model: Model): SimResult | null {
  try {
    return simulate(model);
  } catch {
    return null;
  }
}

/**
 * Whether two runs differ anywhere, relative to the size of the values involved. A fault that
 * leaves every series identical is not findable — and a stock that moved from 1000.0000001 to 1000
 * has not differed either.
 */
function behaviourChanged(a: SimResult, b: SimResult): boolean {
  const names = new Set([...Object.keys(a.series), ...Object.keys(b.series)]);
  for (const name of names) {
    const x = a.series[name];
    const y = b.series[name];
    if (!x || !y || x.length !== y.length) return true;
    for (let i = 0; i < x.length; i++) {
      const p = x[i]!;
      const q = y[i]!;
      if (!Number.isFinite(p) || !Number.isFinite(q)) {
        if (p !== q) return true;
        continue;
      }
      const scale = Math.max(1e-9, Math.abs(p), Math.abs(q));
      if (Math.abs(p - q) / scale > 1e-6) return true;
    }
  }
  return false;
}
