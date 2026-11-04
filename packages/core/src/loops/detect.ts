import { outerAttachment, pipeRelationSide } from "../layout/pipeRelation.js";
import { allVariables, type Model, type Variable } from "../model/types.js";
import { buildSignedGraph, type SignedEdge } from "./graph.js";
import type { DetectLoopsOptions, Loop, LoopDirection } from "./types.js";

interface RawCycle {
  nodeIds: string[];
  signs: (1 | -1)[];
}

/**
 * Enumerates simple (elementary) cycles in a directed graph, one representative per rotation:
 * each cycle is only ever found starting from its lowest-ranked node, and only visits nodes
 * ranked >= the start, which is the standard trick (as in Johnson's algorithm) for avoiding
 * reporting the same cycle once per starting point. Bounded by `maxLength`/`maxCycles` since
 * cycle counts can blow up combinatorially on a densely connected graph.
 */
function findElementaryCycles(adjacency: Map<string, SignedEdge[]>, maxLength: number, maxCycles: number): RawCycle[] {
  const nodeIds = [...adjacency.keys()];
  const rank = new Map(nodeIds.map((id, i) => [id, i]));
  const cycles: RawCycle[] = [];

  function dfs(start: string, current: string, path: string[], signs: (1 | -1)[], visited: Set<string>): void {
    if (cycles.length >= maxCycles || path.length > maxLength) return;
    for (const edge of adjacency.get(current) ?? []) {
      if (cycles.length >= maxCycles) return;
      if (edge.to === start && path.length >= 2) {
        cycles.push({ nodeIds: [...path], signs: [...signs, edge.sign] });
        continue;
      }
      if ((rank.get(edge.to) ?? -1) < (rank.get(start) ?? 0)) continue;
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      dfs(start, edge.to, [...path, edge.to], [...signs, edge.sign], visited);
      visited.delete(edge.to);
    }
  }

  for (const start of nodeIds) {
    if (cycles.length >= maxCycles) break;
    dfs(start, start, [start], [], new Set([start]));
  }
  return cycles;
}

/** Shoelace formula, signed area. Positions are canvas/screen coordinates (y grows downward),
 * which flips the usual math-convention sign: a positive result here reads as clockwise on
 * screen, not counterclockwise as it would in a y-up coordinate system. */
function loopDirection(points: { x: number; y: number }[]): LoopDirection {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum > 0 ? "clockwise" : "counterclockwise";
}

/** Moves a badge that landed on a variable (common for a short loop, whose center is the
 * midpoint of two adjacent nodes) to a nearby open spot, fanned so several badges on the
 * same chain do not stack. A center that is already clear stays put. */
function parkBadge(
  centroid: { x: number; y: number },
  boxes: { pos: { x: number; y: number }; size: { width: number; height: number } }[],
  placed: { x: number; y: number }[],
  index: number,
  model: Model,
  byId: Map<string, Variable>,
): { x: number; y: number } {
  const blocked = (point: { x: number; y: number }) =>
    boxes.some(
      (box) =>
        point.x > box.pos.x - 28 &&
        point.x < box.pos.x + box.size.width + 28 &&
        point.y > box.pos.y - 22 &&
        point.y < box.pos.y + box.size.height + 22,
    ) ||
    placed.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 46) ||
    nearPipeRelation(point, model, byId);
  if (!blocked(centroid)) return centroid;
  for (const radius of [56, 84, 112, 146]) {
    for (let step = 0; step < 10; step++) {
      const angle = -Math.PI / 2 + (step - 4.5) * 0.42 + index * 0.35;
      const candidate = { x: centroid.x + Math.cos(angle) * radius, y: centroid.y + Math.sin(angle) * radius };
      if (!blocked(candidate)) return candidate;
    }
  }
  return { x: centroid.x, y: centroid.y - 72 - index * 16 };
}

/** A badge parked on the open-side link under a pipe hides that link. The geometric center
 * of a loop is left alone: this only rejects spots on the outer chord or its bow. */
function nearPipeRelation(point: { x: number; y: number }, model: Model, byId: Map<string, Variable>): boolean {
  for (const connector of model.connectors) {
    const bend = connector.bend;
    if (!bend) continue;
    const from = byId.get(connector.from);
    const to = byId.get(connector.to);
    if (!from || !to) continue;
    const side = pipeRelationSide(model, connector.from, connector.to);
    if (!side) continue;
    const a = outerAttachment(from, side);
    const b = outerAttachment(to, side);
    if (nearSegment(point, a, b, 20)) return true;
    for (let step = 1; step <= 7; step++) {
      const t = step / 8;
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * bend.x + t * t * b.x;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * bend.y + t * t * b.y;
      if (Math.hypot(x - point.x, y - point.y) < 20) return true;
    }
  }
  return false;
}

function nearSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, pad: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)) < pad;
}

export function detectLoops(model: Model, options: DetectLoopsOptions = {}): Loop[] {
  const { maxLength = 8, maxCycles = 60, limit = 24 } = options;
  const adjacency = buildSignedGraph(model);
  // The loop's visual center must be the average of each node's actual CENTER, not its top-left
  // corner (`v.pos`, React Flow's convention) — averaging corners systematically biases the
  // centroid up-and-left of where the shapes (and the relation lines connecting them) visually
  // sit, by roughly half a node's width/height. This was the actual cause of the badge/
  // annotation landing visibly off-center from the loop it's labeling.
  const centerById = new Map(allVariables(model).map((v) => [v.id, { x: v.pos.x + v.size.width / 2, y: v.pos.y + v.size.height / 2 }]));

  const raw = findElementaryCycles(adjacency, maxLength, maxCycles);

  const loops: Loop[] = raw.map((cycle, i) => {
    const negativeCount = cycle.signs.filter((s) => s === -1).length;
    const points = cycle.nodeIds.map((id) => centerById.get(id) ?? { x: 0, y: 0 });
    const rawCentroid = {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
    return {
      id: `loop_${cycle.nodeIds.join("_")}_${i}`,
      nodeIds: cycle.nodeIds,
      polarity: negativeCount % 2 === 0 ? ("R" as const) : ("B" as const),
      direction: loopDirection(points),
      centroid: rawCentroid,
      number: 0, // assigned below, once the final shortest-first order is settled
    };
  });

  loops.sort((a, b) => a.nodeIds.length - b.nodeIds.length);
  const limited = loops.slice(0, limit);

  // Numbered per polarity (R1, R2, ... / B1, B2, ...) in this same shortest-first order, so the
  // numbering matches how a modeler would naturally scan the diagram for "the first loop", not
  // an arbitrary internal id.
  const counts: Record<"R" | "B", number> = { R: 0, B: 0 };
  const boxes = allVariables(model).map((variable) => ({ pos: variable.pos, size: variable.size }));
  const byId = new Map(allVariables(model).map((variable) => [variable.id, variable]));
  const parked: { x: number; y: number }[] = [];
  for (const loop of limited) {
    counts[loop.polarity] += 1;
    loop.number = counts[loop.polarity];
    loop.centroid = parkBadge(loop.centroid, boxes, parked, loop.number, model, byId);
    parked.push(loop.centroid);
  }

  return limited;
}
