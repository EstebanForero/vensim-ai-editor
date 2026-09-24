// Everything a detector is written against: the model's loop structure, the helpers for asking
// questions of it, and the shape a detector answers in.
//
// Kept apart from the detectors themselves so that adding an archetype means writing one function
// here-shaped, not re-deriving the shared preamble. The three loop-pair detectors in particular
// all want the same thing — every unordered pair of loops, with the shared and private node sets
// already worked out — and each used to spell that out for itself.

import { tryParseExpr } from "../mdl/expr/index.js";
import { buildSignedGraph, type SignedEdge } from "../loops/graph.js";
import type { Loop } from "../loops/types.js";
import { allVariables, type Model, type Variable } from "../model/types.js";
import { isDelayFunction } from "../sim/lowerDelays.js";
import type { ArchetypeConfidence, ArchetypeMatch } from "./types.js";

export interface ArchetypeContext {
  model: Model;
  loops: Loop[];
  names: Map<string, string>;
  kinds: Map<string, Variable["kind"]>;
  /** Signed adjacency — reused for the cross-loop edge questions (does A's part of the diagram
   * push B's part down?) that the loop node lists alone can't answer. */
  adjacency: Map<string, SignedEdge[]>;
  /** Variables whose equation runs through a delay. Computed once, since more than one detector
   * asks and parsing an equation is the expensive part of this whole analysis. */
  delayed: Map<string, boolean>;
}

/** What a detector reports about one match. The collector fills in the id, archetype and label,
 * so a detector never repeats its own name and never invents its own identity. */
export type Evidence = Omit<ArchetypeMatch, "id" | "archetype" | "label">;

/** The label the canvas badge shows for this loop (R1, B2, ...), so a candidate in the report can
 * be traced to what's drawn on the diagram. */
export function loopLabel(loop: Loop): string {
  return `${loop.polarity}${loop.number}`;
}

export function sharedNodes(a: Loop, b: Loop): string[] {
  return a.nodeIds.filter((id) => b.nodeIds.includes(id));
}

/** A loop's nodes that this other loop doesn't touch — the part of it that's genuinely its own. */
export function privateNodes(loop: Loop, other: Loop): string[] {
  return loop.nodeIds.filter((id) => !other.nodeIds.includes(id));
}

export function nameList(ctx: ArchetypeContext, ids: string[]): string {
  return ids.map((id) => `\`${ctx.names.get(id) ?? id}\``).join(", ");
}

/** Signed edges from any of `from` into any of `to` with the given sign. */
export function crossEdges(
  ctx: ArchetypeContext,
  from: string[],
  to: string[],
  sign: 1 | -1,
): { from: string; to: string }[] {
  const edges: { from: string; to: string }[] = [];
  for (const u of from) {
    for (const e of ctx.adjacency.get(u) ?? []) {
      if (e.sign === sign && to.includes(e.to)) edges.push({ from: u, to: e.to });
    }
  }
  return edges;
}

export interface LoopPair {
  a: Loop;
  b: Loop;
  shared: string[];
  /** Nodes of `a` that `b` doesn't touch. */
  aOnly: string[];
  /** Nodes of `b` that `a` doesn't touch. */
  bOnly: string[];
}

/** Every unordered pair of loops, with the shared/private split already computed. Pass `accept`
 * to narrow it (see `reinforcingPairs`) — the split is cheap, and doing it once here is what
 * keeps each detector from restating it. */
export function loopPairs(ctx: ArchetypeContext, accept?: (a: Loop, b: Loop) => boolean): LoopPair[] {
  const pairs: LoopPair[] = [];
  for (let i = 0; i < ctx.loops.length; i++) {
    for (let j = i + 1; j < ctx.loops.length; j++) {
      const a = ctx.loops[i]!;
      const b = ctx.loops[j]!;
      if (accept && !accept(a, b)) continue;
      pairs.push({ a, b, shared: sharedNodes(a, b), aOnly: privateNodes(a, b), bOnly: privateNodes(b, a) });
    }
  }
  return pairs;
}

/** Pairs where both loops reinforce — Escalation and Success to the Successful are built on
 * these. */
export function reinforcingPairs(ctx: ArchetypeContext): LoopPair[] {
  return loopPairs(ctx, (a, b) => a.polarity === "R" && b.polarity === "R");
}

/**
 * Whether this variable's equation runs through a delay.
 *
 * Read from the equation rather than the diagram, because a delay has no shape on the canvas: it
 * is written inside a variable's equation, so `detectLoops` cannot see it and the loop structure
 * alone can never answer this. That is exactly why the delay-dependent archetypes were
 * undetectable before the simulator learned DELAY — "which of these two paths is the slow one" is
 * a question about equations, not arrows.
 */
export function delaysOn(ctx: ArchetypeContext, varId: string): boolean {
  return ctx.delayed.get(varId) ?? false;
}

/** Assembles a match from ids. Deriving `nodeNames` here rather than at each call site is what
 * keeps a detector from reporting ids and names that disagree with each other. */
export function evidence(
  ctx: ArchetypeContext,
  input: { loops: Loop[]; nodes: string[]; summary: string; confidence: ArchetypeConfidence },
): Evidence {
  return {
    confidence: input.confidence,
    summary: input.summary,
    loopIds: input.loops.map((l) => l.id),
    loopLabels: input.loops.map(loopLabel),
    nodeIds: input.nodes,
    nodeNames: input.nodes.map((id) => ctx.names.get(id) ?? id),
  };
}

function containsDelayCall(e: ReturnType<typeof tryParseExpr>): boolean {
  if (!e) return false;
  switch (e.type) {
    case "call":
      return isDelayFunction(e.name) || e.args.some(containsDelayCall);
    case "unary":
      return containsDelayCall(e.arg);
    case "binary":
      return containsDelayCall(e.left) || containsDelayCall(e.right);
    default:
      return false;
  }
}

export function buildContext(model: Model, loops: Loop[]): ArchetypeContext {
  const variables = allVariables(model);
  const knownNames = variables.map((v) => v.name);
  const delayed = new Map<string, boolean>();
  for (const v of variables) {
    const equation = v.kind === "stock" ? v.initialEquation : v.equation;
    delayed.set(v.id, containsDelayCall(tryParseExpr(equation, knownNames)));
  }

  return {
    model,
    loops,
    names: new Map(variables.map((v) => [v.id, v.name])),
    kinds: new Map(variables.map((v) => [v.id, v.kind])),
    adjacency: buildSignedGraph(model),
    delayed,
  };
}
