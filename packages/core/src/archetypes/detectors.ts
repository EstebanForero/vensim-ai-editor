// One function per archetype. Each answers "where does this model's structure look like this
// pattern?", in terms of the helpers in context.ts, and reports structure only — never an
// interpretation of it. That split is the whole design: the archetype's *name* supplies the
// pattern, the summary says what was actually found, and the reader checks one against the other.

import {
  crossEdges,
  delaysOn,
  evidence,
  loopLabel,
  loopPairs,
  nameList,
  reinforcingPairs,
  type ArchetypeContext,
  type Evidence,
} from "./context.js";
import type { Loop } from "../loops/types.js";

/**
 * Limits to Growth — a reinforcing loop and a balancing loop acting on the same stock. The R
 * loop is the growth engine; the B loop is the constraint that eventually throttles it.
 *
 * Fires on the *shared stock* alone. That's the canonical signature, and it's also the weakest
 * one here: two unrelated loops that happen to touch the same stock look identical to a real
 * limit, so this reports "likely" only when the two loops share nothing else — a shared stock
 * plus shared intermediate variables is more often one loop's return path than a limit.
 */
export function limitsToGrowth(ctx: ArchetypeContext): Evidence[] {
  const out: Evidence[] = [];
  for (const { a, b, shared } of loopPairs(ctx, (x, y) => x.polarity !== y.polarity)) {
    const reinforcing = a.polarity === "R" ? a : b;
    const balancing = a.polarity === "B" ? a : b;
    const stocks = shared.filter((id) => ctx.kinds.get(id) === "stock");
    if (stocks.length === 0) continue;
    out.push(
      evidence(ctx, {
        loops: [reinforcing, balancing],
        nodes: stocks,
        confidence: shared.length === stocks.length ? "likely" : "possible",
        summary: `${loopLabel(reinforcing)} (reinforcing) and ${loopLabel(balancing)} (balancing) both act on the stock ${nameList(ctx, stocks)}.`,
      }),
    );
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
export function tragedyOfTheCommons(ctx: ArchetypeContext): Evidence[] {
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
    out.push(
      evidence(ctx, {
        loops: involved,
        nodes: [stock.id, ...outflows],
        confidence: "likely",
        summary: `${nameList(ctx, [stock.id])} is drawn down by ${outflows.length} separate flows (${nameList(
          ctx,
          outflows,
        )}), each with its own loop (${involved.map(loopLabel).join(", ")}).`,
      }),
    );
  }
  return out;
}

/**
 * Escalation — a reinforcing loop running through two sides, each of which feeds the other, so
 * neither can stop without falling behind.
 *
 * This signature used to ask for something else: two reinforcing loops, each pushing the other's
 * private nodes *down*. That is not a race, it is a dominance spiral, and the two can be told
 * apart by watching them run. The old signature's example had each side building in proportion to
 * how far *ahead* it was, so the side that fell behind stopped rearming — and switching the
 * loser's production off made the winner grow faster, the exact opposite of "neither can leave".
 * It also fired on Success to the Successful models, which is the shape it really describes.
 *
 * The correction is that coupling has to be *positive*: escalation is "each responds in kind",
 * and a response is a feed, not a suppression. Two mutually feeding sides form one reinforcing
 * loop rather than two, because neither side has a reinforcing loop of its own — which is why
 * the old signature could never match a real arms race, however it was written up.
 *
 * A loop carrying more (or fewer) than two stocks is left alone: there is no pair to race.
 */
export function escalation(ctx: ArchetypeContext): Evidence[] {
  const out: Evidence[] = [];
  for (const loop of ctx.loops) {
    if (loop.polarity !== "R") continue;
    const sides = raceOf(ctx, loop);
    if (!sides) continue;
    out.push(
      evidence(ctx, {
        loops: [loop],
        nodes: loop.nodeIds,
        confidence: "likely",
        summary: `${loopLabel(loop)} runs through ${nameList(ctx, sides)} and back round — each one's growth is part of what drives the other's, so neither can stop without falling behind.`,
      }),
    );
  }
  return out;
}

/** The two sides of this loop, if it is a race at all: exactly two stocks, and the way round from
 * one to the other a *feed* rather than a suppression. Because the loop as a whole reinforces, its
 * two halves carry the same sign — so checking one direction settles both. */
function raceOf(ctx: ArchetypeContext, loop: Loop): [string, string] | null {
  const at = loop.nodeIds.flatMap((id, i) => (ctx.kinds.get(id) === "stock" ? [i] : []));
  if (at.length !== 2) return null;
  const [i, j] = at as [number, number];
  if (pathSign(ctx, loop, i, j) !== 1) return null;
  // Neither side may drive its own inflow. That is what separates a race from a stock that is
  // simply a *consequence* of the other — accumulated damage, a by-product, a spillover — which
  // reinforces in exactly the same shape and is what Fixes that Fail is made of.
  if (selfDriven(ctx, loop, i) || selfDriven(ctx, loop, j)) return null;
  return [loop.nodeIds[i]!, loop.nodeIds[j]!];
}

/** The sign of the edge chain from one position in the loop round to another: +1 for an even
 * number of negative links along the way, -1 for an odd number. */
function pathSign(ctx: ArchetypeContext, loop: Loop, from: number, to: number): 1 | -1 {
  const n = loop.nodeIds.length;
  let sign: 1 | -1 = 1;
  for (let k = from; k !== to; k = (k + 1) % n) {
    const edge = (ctx.adjacency.get(loop.nodeIds[k]!) ?? []).find((e) => e.to === loop.nodeIds[(k + 1) % n]!);
    if (edge?.sign === -1) sign = sign === 1 ? -1 : 1;
  }
  return sign;
}

/** Whether the stock at this position in the loop also feeds the node that feeds *it* — the stock
 * growing on its own momentum rather than in response to the other side. */
function selfDriven(ctx: ArchetypeContext, loop: Loop, at: number): boolean {
  const n = loop.nodeIds.length;
  const stock = loop.nodeIds[at]!;
  const inflow = loop.nodeIds[(at - 1 + n) % n]!;
  return (ctx.adjacency.get(stock) ?? []).some((e) => e.to === inflow);
}

/**
 * Success to the Successful — two reinforcing loops that both feed off one shared allocation
 * node, so whichever side is ahead gets more of it and pulls further ahead.
 *
 * The shared node is required to be a non-stock (the allocator: a split, a share, a rate) that
 * feeds each loop's *private* part. A shared stock would make this indistinguishable from two
 * ordinary growth loops on one inventory, which is a different structure.
 */
export function successToTheSuccessful(ctx: ArchetypeContext): Evidence[] {
  const out: Evidence[] = [];
  for (const { a, b, shared, aOnly, bOnly } of reinforcingPairs(ctx)) {
    if (aOnly.length === 0 || bOnly.length === 0) continue;
    for (const allocId of shared) {
      if (ctx.kinds.get(allocId) === "stock") continue;
      // The allocation has to actually feed both sides — a node the two loops merely both pass
      // through on the way to somewhere else is a shared dependency, not a split.
      if (crossEdges(ctx, [allocId], aOnly, 1).length === 0) continue;
      if (crossEdges(ctx, [allocId], bOnly, 1).length === 0) continue;
      const nodes = [allocId, ...aOnly, ...bOnly];
      out.push(
        evidence(ctx, {
          loops: [a, b],
          nodes,
          confidence: "likely",
          summary: `${loopLabel(a)} and ${loopLabel(b)} each reinforce and both draw on ${nameList(ctx, [
            allocId,
          ])}, which feeds ${nameList(ctx, aOnly)} and ${nameList(ctx, bOnly)} separately.`,
        }),
      );
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
export function fixesThatFail(ctx: ArchetypeContext): Evidence[] {
  const out: Evidence[] = [];
  for (const { a, b, shared, aOnly, bOnly } of loopPairs(ctx, (x, y) => x.polarity !== y.polarity)) {
    if (shared.length < 2) continue;
    const balancing = a.polarity === "B" ? a : b;
    const reinforcing = a.polarity === "R" ? a : b;
    const balancingOnly = a.polarity === "B" ? aOnly : bOnly;
    const reinforcingOnly = a.polarity === "R" ? aOnly : bOnly;
    if (balancingOnly.length === 0 && reinforcingOnly.length === 0) continue;
    // A loop with nothing of its own is just the shared pair, which reads as a bare cycle
    // label rather than "label via ..." — naming an empty detour would be noise.
    const via = (loop: typeof a, own: string[]) =>
      own.length > 0 ? `${loopLabel(loop)} via ${nameList(ctx, own)}` : loopLabel(loop);
    out.push(
      evidence(ctx, {
        loops: [balancing, reinforcing],
        nodes: shared,
        confidence: "likely",
        summary: `${loopLabel(balancing)} (balancing) and ${loopLabel(reinforcing)} (reinforcing) are two different paths between ${nameList(
          ctx,
          shared,
        )} — ${via(balancing, balancingOnly)}, ${via(reinforcing, reinforcingOnly)}.`,
      }),
    );
  }
  return out;
}

/**
 * Shifting the Burden — a problem with two solutions that both work: one that takes effect at
 * once, and one that takes time, where the fast one erodes the slow one's capacity so the fast
 * one has to keep being applied.
 *
 * The delay is the entire discriminator, and the reason this archetype could not be detected
 * until the simulator learned DELAY. "Symptomatic vs fundamental" is a fact about intent and is
 * not recoverable from arrows — but *which of the two paths is slow* is readable from the
 * equations, and it is the reading the archetype literature actually turns on: the symptomatic
 * fix works immediately, the fundamental one takes time to build. So the undelayed loop is read
 * as the symptomatic fix and the delayed one as the fundamental solution.
 *
 * Reported as "likely" only when a reinforcing loop also spans both — the side effect by which
 * the fast fix erodes the slow one's capacity. That loop is what makes the pattern a trap rather
 * than two options, but the two-path structure alone is still the archetype, so it strengthens
 * the match rather than gating it.
 */
export function shiftingTheBurden(ctx: ArchetypeContext): Evidence[] {
  const out: Evidence[] = [];
  for (const { a, b, shared, aOnly, bOnly } of loopPairs(ctx, (x, y) => x.polarity === "B" && y.polarity === "B")) {
    if (shared.length === 0) continue;
    const aDelayed = a.nodeIds.some((id) => delaysOn(ctx, id));
    const bDelayed = b.nodeIds.some((id) => delaysOn(ctx, id));
    // Both slow or neither: not the fast-path-plus-slow-path structure this is about.
    if (aDelayed === bDelayed) continue;

    const fast = aDelayed ? b : a;
    const slow = aDelayed ? a : b;
    const fastOnly = aDelayed ? bOnly : aOnly;
    const slowOnly = aDelayed ? aOnly : bOnly;

    const erosion = ctx.loops.some(
      (l) =>
        l.polarity === "R" &&
        l.nodeIds.some((id) => fastOnly.includes(id)) &&
        l.nodeIds.some((id) => slowOnly.includes(id)),
    );

    out.push(
      evidence(ctx, {
        loops: [fast, slow],
        nodes: [...shared, ...slowOnly],
        confidence: erosion ? "likely" : "possible",
        summary: `${loopLabel(fast)} and ${loopLabel(slow)} both act on ${nameList(
          ctx,
          shared,
        )}, but only ${loopLabel(slow)} (via ${nameList(ctx, slowOnly)}) runs through a delay${
          erosion ? `, and ${loopLabel(fast)}'s side of the diagram feeds back into it through a reinforcing loop` : ""
        }.`,
      }),
    );
  }
  return out;
}

