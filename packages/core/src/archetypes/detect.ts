// Structural detection of the classic system-dynamics archetypes — named compositions of
// feedback loops (Limits to Growth, Tragedy of the Commons, Escalation, ...).
//
// This is *candidate* detection, not classification, and the distinction is the whole design.
// An archetype's structural signature is a necessary condition, not a sufficient one: any R
// loop and B loop that happen to act on the same stock match "Limits to Growth" whether or not
// the modeler meant them to, and a three-loop diagram will match several archetypes at once.
// A detector that asserted "this model IS Limits to Growth" would therefore be wrong often
// enough to be worse than nothing — so every match instead reports the loops and variables that
// produced it, and the reader confirms or dismisses it at a glance.
//
// Only structures fully decidable from the signed graph are detected. The delay-dependent
// archetypes are left out rather than guessed at: telling Shifting the Burden from Fixes that
// Fail turns on which of the two paths is slow, and DELAY/SMOOTH aren't implemented (they're
// absent from the function registry, so they throw at simulation time) — there is nothing to
// read that off yet.
//
// Loop enumeration is bounded by `detectLoops`' own defaults (maxLength 8, maxCycles 60,
// limit 24), so on a densely connected model the loops a match is built from are themselves a
// subset of all loops present. That's a ceiling on what this can see, not a source of wrong
// answers: every match it reports is really there.

import { detectLoops } from "../loops/detect.js";
import { buildSignedGraph, type SignedEdge } from "../loops/graph.js";
import type { Loop } from "../loops/types.js";
import { allVariables, type Model, type Variable } from "../model/types.js";
import type { ArchetypeConfidence, ArchetypeId, ArchetypeMatch, DetectArchetypesOptions } from "./types.js";

const LABELS: Record<ArchetypeId, string> = {
  "limits-to-growth": "Limits to Growth",
  "tragedy-of-the-commons": "Tragedy of the Commons",
  escalation: "Escalation",
  "success-to-the-successful": "Success to the Successful",
  "fixes-that-fail": "Fixes that Fail",
};

/** Report order — the order these appear in `ArchetypeId`, so output is stable and grouped. */
const ORDER: ArchetypeId[] = [
  "limits-to-growth",
  "tragedy-of-the-commons",
  "escalation",
  "success-to-the-successful",
  "fixes-that-fail",
];

interface Ctx {
  model: Model;
  loops: Loop[];
  names: Map<string, string>;
  kinds: Map<string, Variable["kind"]>;
  /** Signed adjacency, reused for the cross-loop edge questions (does A's part of the diagram
   * push B's part down?) that the loop node lists alone can't answer. */
  adjacency: Map<string, SignedEdge[]>;
}

/** What a match reports minus the fields the collector fills in, so each detector below never
 * repeats its own name or invents its own id. */
type Evidence = Omit<ArchetypeMatch, "id" | "archetype" | "label">;

/** The label the canvas badge shows for this loop (R1, B2, ...), so a candidate in the report
 * can be traced to what's drawn on the diagram. */
function loopLabel(loop: Loop): string {
  return `${loop.polarity}${loop.number}`;
}

function sharedNodes(a: Loop, b: Loop): string[] {
  return a.nodeIds.filter((id) => b.nodeIds.includes(id));
}

/** A loop's nodes that this other loop doesn't touch — the part of it that's genuinely its own. */
function privateNodes(loop: Loop, other: Loop): string[] {
  return loop.nodeIds.filter((id) => !other.nodeIds.includes(id));
}

function nameList(ctx: Ctx, ids: string[]): string {
  return ids.map((id) => `\`${ctx.names.get(id) ?? id}\``).join(", ");
}

/** Signed edges from any of `from` into any of `to` with the given sign. */
function crossEdges(ctx: Ctx, from: string[], to: string[], sign: 1 | -1): { from: string; to: string }[] {
  const edges: { from: string; to: string }[] = [];
  for (const u of from) {
    for (const e of ctx.adjacency.get(u) ?? []) {
      if (e.sign === sign && to.includes(e.to)) edges.push({ from: u, to: e.to });
    }
  }
  return edges;
}

/**
 * Limits to Growth — a reinforcing loop and a balancing loop acting on the same stock. The R
 * loop is the growth engine; the B loop is the constraint that eventually throttles it.
 *
 * Fires on the *shared stock* alone. That's the canonical signature, and it's also the weakest
 * one here: two unrelated loops that happen to touch the same stock look identical to a real
 * limit, so this reports "likely" only when the two loops share nothing else — a shared stock
 * plus shared intermediate variables is more often one loop's return path than a limit.
 */
function limitsToGrowth(ctx: Ctx): Evidence[] {
  const out: Evidence[] = [];
  for (const r of ctx.loops.filter((l) => l.polarity === "R")) {
    for (const b of ctx.loops.filter((l) => l.polarity === "B")) {
      const shared = sharedNodes(r, b);
      const stocks = shared.filter((id) => ctx.kinds.get(id) === "stock");
      if (stocks.length === 0) continue;
      const confidence: ArchetypeConfidence = shared.length === stocks.length ? "likely" : "possible";
      out.push({
        confidence,
        summary: `${loopLabel(r)} (reinforcing) and ${loopLabel(b)} (balancing) both act on the stock ${nameList(ctx, stocks)}.`,
        loopIds: [r.id, b.id],
        loopLabels: [loopLabel(r), loopLabel(b)],
        nodeIds: stocks,
        nodeNames: stocks.map((id) => ctx.names.get(id) ?? id),
      });
    }
  }
  return out;
}

/**
 * Tragedy of the Commons — one shared stock drawn down by more than one independent feedback
 * path, so each user's draw is a separate loop and no single flow's depletion is "the" one.
 *
 * Read structurally: a stock with two or more outflows, at least two of which are each carried
 * by a loop that carries that outflow *alone*. That last condition is what separates competing
 * users from a single loop that merely happens to reach the stock through two pipes — counting
 * outflows instead would call that one actor two.
 *
 * Note the ceiling: Vensim models the commons properly with subscripts (N farmers, one array),
 * and subscripts aren't modeled here. What this detects is the *aggregate* form — the shares
 * collapsed into separate variables — which is how the archetype reads when it's drawn by hand.
 */
function tragedyOfTheCommons(ctx: Ctx): Evidence[] {
  const out: Evidence[] = [];
  for (const stock of ctx.model.stocks) {
    if (stock.outflows.length < 2) continue;
    const throughStock = ctx.loops.filter((l) => l.nodeIds.includes(stock.id));
    const alone = (outflow: string) =>
      throughStock.filter(
        (l) => l.nodeIds.includes(outflow) && !stock.outflows.some((o) => o !== outflow && l.nodeIds.includes(o)),
      );
    const outflows = stock.outflows.filter((o) => alone(o).length > 0);
    if (outflows.length < 2) continue;
    // One loop per outflow, by construction — a loop that drains `Use A` alone can't be the same
    // loop that drains `Use B` alone.
    const involved = [...new Map(outflows.flatMap((o) => alone(o)).map((l) => [l.id, l])).values()];
    out.push({
      confidence: "likely",
      summary: `${nameList(ctx, [stock.id])} is drawn down by ${outflows.length} separate flows (${nameList(
        ctx,
        outflows,
      )}), each with its own loop (${involved.map(loopLabel).join(", ")}).`,
      loopIds: involved.map((l) => l.id),
      loopLabels: involved.map(loopLabel),
      nodeIds: [stock.id, ...outflows],
      nodeNames: [stock.id, ...outflows].map((id) => ctx.names.get(id) ?? id),
    });
  }
  return out;
}

/**
 * Escalation — two reinforcing loops, each pushing the other's own part of the diagram down, so
 * that each side's growth is the other's problem and neither can back off without losing ground.
 *
 * The negative edges are required to cross between each loop's *private* nodes. Without that,
 * two loops that merely share a node would match on the shared node's edges alone — a
 * self-inflicted dip in a common variable, not a fight between two sides.
 */
function escalation(ctx: Ctx): Evidence[] {
  const out: Evidence[] = [];
  const reinforcing = ctx.loops.filter((l) => l.polarity === "R");
  for (let i = 0; i < reinforcing.length; i++) {
    for (let j = i + 1; j < reinforcing.length; j++) {
      const a = reinforcing[i]!;
      const b = reinforcing[j]!;
      const aOnly = privateNodes(a, b);
      const bOnly = privateNodes(b, a);
      if (aOnly.length === 0 || bOnly.length === 0) continue;
      const aPushesDown = crossEdges(ctx, aOnly, bOnly, -1);
      const bPushesDown = crossEdges(ctx, bOnly, aOnly, -1);
      if (aPushesDown.length === 0 || bPushesDown.length === 0) continue;
      const nodes = [...new Set([...aPushesDown, ...bPushesDown].flatMap((e) => [e.from, e.to]))];
      const edge = (e: { from: string; to: string }) => `${nameList(ctx, [e.from])} → ${nameList(ctx, [e.to])}`;
      out.push({
        confidence: "likely",
        summary: `${loopLabel(a)} and ${loopLabel(b)} both reinforce, and each pushes the other down (${aPushesDown
          .map(edge)
          .join(", ")}; ${bPushesDown.map(edge).join(", ")}).`,
        loopIds: [a.id, b.id],
        loopLabels: [loopLabel(a), loopLabel(b)],
        nodeIds: nodes,
        nodeNames: nodes.map((id) => ctx.names.get(id) ?? id),
      });
    }
  }
  return out;
}

/**
 * Success to the Successful — two reinforcing loops that both feed off one shared allocation
 * node, so whichever side is ahead gets more of it and pulls further ahead.
 *
 * The shared node is required to be a non-stock (the allocator: a split, a share, a rate) that
 * feeds each loop's *private* part. A shared stock would make this indistinguishable from two
 * ordinary growth loops on one inventory, which is a different structure.
 */
function successToTheSuccessful(ctx: Ctx): Evidence[] {
  const out: Evidence[] = [];
  const reinforcing = ctx.loops.filter((l) => l.polarity === "R");
  for (let i = 0; i < reinforcing.length; i++) {
    for (let j = i + 1; j < reinforcing.length; j++) {
      const a = reinforcing[i]!;
      const b = reinforcing[j]!;
      const aOnly = privateNodes(a, b);
      const bOnly = privateNodes(b, a);
      if (aOnly.length === 0 || bOnly.length === 0) continue;
      for (const allocId of sharedNodes(a, b)) {
        if (ctx.kinds.get(allocId) === "stock") continue;
        // The allocation has to actually feed both sides — a node the two loops merely both
        // pass through on the way to somewhere else is a shared dependency, not a split.
        if (crossEdges(ctx, [allocId], aOnly, 1).length === 0) continue;
        if (crossEdges(ctx, [allocId], bOnly, 1).length === 0) continue;
        const nodes = [allocId, ...aOnly, ...bOnly];
        out.push({
          confidence: "likely",
          summary: `${loopLabel(a)} and ${loopLabel(b)} each reinforce and both draw on ${nameList(ctx, [
            allocId,
          ])}, which feeds ${nameList(ctx, aOnly)} and ${nameList(ctx, bOnly)} separately.`,
          loopIds: [a.id, b.id],
          loopLabels: [loopLabel(a), loopLabel(b)],
          nodeIds: nodes,
          nodeNames: nodes.map((id) => ctx.names.get(id) ?? id),
        });
      }
    }
  }
  return out;
}

/**
 * Fixes that Fail — a balancing loop and a reinforcing loop running between the same two
 * variables: one path is the fix pulling the problem down, the other is the unintended
 * consequence pushing it back up.
 *
 * Read structurally: two loops of opposite polarity running between the same two variables,
 * where at least one of them detours through something the other doesn't. Which of the shared
 * pair is the "fix" isn't recoverable from the graph — that's a fact about intent, not wiring —
 * so the summary names the pair and leaves the reading to the modeler.
 *
 * Only *one* of the two loops needs a node of its own. The minimal case — problem and fix
 * wired straight to each other, with the unintended consequence riding on a third variable —
 * has the balancing loop as just the bare pair, and demanding a detour on both sides would
 * exclude exactly the shape this archetype is usually drawn in.
 */
function fixesThatFail(ctx: Ctx): Evidence[] {
  const out: Evidence[] = [];
  for (const b of ctx.loops.filter((l) => l.polarity === "B")) {
    for (const r of ctx.loops.filter((l) => l.polarity === "R")) {
      const shared = sharedNodes(b, r);
      if (shared.length < 2) continue;
      const bOnly = privateNodes(b, r);
      const rOnly = privateNodes(r, b);
      if (bOnly.length === 0 && rOnly.length === 0) continue;
      // A loop with nothing of its own is just the shared pair, which reads as a bare cycle
      // label rather than "label via ..." — naming an empty detour would be noise.
      const via = (loop: Loop, own: string[]) =>
        own.length > 0 ? `${loopLabel(loop)} via ${nameList(ctx, own)}` : loopLabel(loop);
      out.push({
        confidence: "likely",
        summary: `${loopLabel(b)} (balancing) and ${loopLabel(r)} (reinforcing) are two different paths between ${nameList(
          ctx,
          shared,
        )} — ${via(b, bOnly)}, ${via(r, rOnly)}.`,
        loopIds: [b.id, r.id],
        loopLabels: [loopLabel(b), loopLabel(r)],
        nodeIds: shared,
        nodeNames: shared.map((id) => ctx.names.get(id) ?? id),
      });
    }
  }
  return out;
}

const DETECTORS: Record<ArchetypeId, (ctx: Ctx) => Evidence[]> = {
  "limits-to-growth": limitsToGrowth,
  "tragedy-of-the-commons": tragedyOfTheCommons,
  escalation,
  "success-to-the-successful": successToTheSuccessful,
  "fixes-that-fail": fixesThatFail,
};

/**
 * Reports which classic archetypes the model's *structure* matches, as candidates to confirm
 * rather than a classification of what the model is. See the file header for why.
 *
 * A model with no feedback loops returns nothing, and so does one whose loops match no
 * signature — an empty result means "no structural match found", never "no archetype here".
 */
export function detectArchetypes(model: Model, options: DetectArchetypesOptions = {}): ArchetypeMatch[] {
  const { limit = 12 } = options;
  const loops = detectLoops(model);
  if (loops.length === 0) return [];

  const variables = allVariables(model);
  const ctx: Ctx = {
    model,
    loops,
    names: new Map(variables.map((v) => [v.id, v.name])),
    kinds: new Map(variables.map((v) => [v.id, v.kind])),
    adjacency: buildSignedGraph(model),
  };

  const matches: ArchetypeMatch[] = [];
  const seen = new Set<string>();
  for (const archetype of ORDER) {
    for (const evidence of DETECTORS[archetype](ctx)) {
      // The same structure can be reached more than once — a pair of reinforcing loops is
      // examined once as (a, b) and once as (b, a) by any detector that iterates combinations —
      // so collapse anything naming the same loops and nodes. Sorting makes that key canonical,
      // which is also what makes it usable as the match's identity.
      const id = `${archetype}|${[...evidence.loopIds].sort().join(",")}|${[...evidence.nodeIds].sort().join(",")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      matches.push({ id, archetype, label: LABELS[archetype], ...evidence });
    }
  }

  matches.sort(
    (a, b) =>
      ORDER.indexOf(a.archetype) - ORDER.indexOf(b.archetype) ||
      (a.confidence === b.confidence ? 0 : a.confidence === "likely" ? -1 : 1) ||
      a.summary.localeCompare(b.summary),
  );
  return matches.slice(0, limit);
}
