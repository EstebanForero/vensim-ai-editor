import { centerOf } from "../layout/geometry.js";
import { outerAttachment, pipeRelationSide } from "../layout/pipeRelation.js";
import { allVariables, type Model, type Variable } from "../model/types.js";
import { buildSignedGraph, type SignedEdge } from "./graph.js";
import { LOOP_BADGE_SIZE, type DetectLoopsOptions, type Loop, type LoopDirection } from "./types.js";

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

const BADGE_HALF_X = LOOP_BADGE_SIZE.width / 2;
const BADGE_HALF_Y = LOOP_BADGE_SIZE.height / 2;
/** How far the pill's center stays from a pipe or a relation stroke. */
const STROKE_PAD = 18;

/** Moves a badge that landed on a variable or on the pipe into the loop's interior.
 * A short loop's center is the midpoint of two nodes, which is the pipe itself, and the old
 * search always started upward, so the marker left the loop whenever the relation bowed the
 * other way. A center that is already clear stays put. With no bend there is no interior to
 * prefer, and the midpoint stays — that is the flat loop's center. */
function parkBadge(
  centroid: { x: number; y: number },
  nodeIds: string[],
  boxes: { pos: { x: number; y: number }; size: { width: number; height: number } }[],
  placed: { x: number; y: number }[],
  index: number,
  model: Model,
  byId: Map<string, Variable>,
): { x: number; y: number } {
  const bow = visibleBow(centroid, nodeIds, model, byId);
  const blocked = (point: { x: number; y: number }) =>
    coversBox(point, boxes) ||
    placed.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < LOOP_BADGE_SIZE.width + 8) ||
    (bow ? coversStroke(point, model, byId) : nearPipeRelation(point, model, byId));
  if (!blocked(centroid)) return centroid;
  // A center that only clips a node moves just off that node. Walking toward the bow
  // instead drops it on the next shape over (a 3-node loop's badge ended up on the flow).
  const slid = slideOffBoxes(centroid, boxes);
  if (slid && !blocked(slid) && Math.hypot(slid.x - centroid.x, slid.y - centroid.y) <= 20) return slid;
  // The control point is not on the arrow. The arrow's middle is halfway from the
  // chord to that control, and a badge walked all the way to the control sits on the
  // line and covers the polarity mark. Look inside the bow first. A lens thinner than
  // the pill has no free spot there, and the badge then goes just outside the line.
  const dir = bow ?? { x: 0, y: -1, len: 72 };
  const base = Math.atan2(dir.y, dir.x);
  const inside = bow ? Math.max(0, dir.len - STROKE_PAD) : 72;
  const ranges: [number, number][] = bow
    ? [
        [16, inside],
        [dir.len + BADGE_HALF_Y + 14, dir.len + BADGE_HALF_Y + 56],
      ]
    : [[16, 72]];
  for (const [start, end] of ranges) {
    for (let dist = start; dist <= end; dist += 4) {
      for (const spread of [0, 0.35, -0.35, 0.75, -0.75]) {
        const angle = base + spread;
        const candidate = { x: centroid.x + Math.cos(angle) * dist, y: centroid.y + Math.sin(angle) * dist };
        if (!blocked(candidate)) return candidate;
      }
    }
  }
  const fallback = bow ? dir.len + BADGE_HALF_Y + 14 : 72;
  const fallen = {
    x: centroid.x + dir.x * fallback,
    y: centroid.y + dir.y * fallback - (bow ? 0 : index * 16),
  };
  return slideOffBoxes(fallen, boxes) ?? slid ?? fallen;
}

/** Pushes a point to the nearest edge of every badge-sized box it still covers. */
function slideOffBoxes(
  point: { x: number; y: number },
  boxes: { pos: { x: number; y: number }; size: { width: number; height: number } }[],
): { x: number; y: number } | null {
  let current = { x: point.x, y: point.y };
  for (let pass = 0; pass < 6; pass++) {
    const box = boxes.find((candidate) => coversBox(current, [candidate]));
    if (!box) return current;
    const left = box.pos.x - BADGE_HALF_X - 4;
    const right = box.pos.x + box.size.width + BADGE_HALF_X + 4;
    const top = box.pos.y - BADGE_HALF_Y - 4;
    const bottom = box.pos.y + box.size.height + BADGE_HALF_Y + 4;
    const options = [
      { x: current.x, y: top, d: Math.abs(current.y - top) },
      { x: current.x, y: bottom, d: Math.abs(current.y - bottom) },
      { x: left, y: current.y, d: Math.abs(current.x - left) },
      { x: right, y: current.y, d: Math.abs(current.x - right) },
    ];
    options.sort((a, b) => a.d - b.d);
    current = { x: options[0]!.x, y: options[0]!.y };
  }
  return null;
}

/** Where this loop's own relations actually bow, the midpoint of each curve rather than
 * its control point. Causes from outside the cycle are not part of the interior. Null when
 * there is no bend, or the bows surround the center (that center is already the interior). */
function visibleBow(
  centroid: { x: number; y: number },
  nodeIds: string[],
  model: Model,
  byId: Map<string, Variable>,
): { x: number; y: number; len: number } | null {
  const ids = new Set(nodeIds);
  const bows: { x: number; y: number }[] = [];
  for (const connector of model.connectors) {
    if (!ids.has(connector.from) || !ids.has(connector.to) || !connector.bend) continue;
    const from = byId.get(connector.from);
    const to = byId.get(connector.to);
    if (!from || !to) continue;
    const side = pipeRelationSide(model, connector.from, connector.to);
    const a = side ? outerAttachment(from, side) : centerOf(from);
    const b = side ? outerAttachment(to, side) : centerOf(to);
    const bend = connector.bend;
    bows.push({ x: 0.25 * a.x + 0.5 * bend.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * bend.y + 0.25 * b.y });
  }
  if (bows.length === 0) return null;
  const avg = {
    x: bows.reduce((sum, bow) => sum + bow.x, 0) / bows.length,
    y: bows.reduce((sum, bow) => sum + bow.y, 0) / bows.length,
  };
  const dx = avg.x - centroid.x;
  const dy = avg.y - centroid.y;
  const len = Math.hypot(dx, dy);
  if (len < 12) return null;
  return { x: dx / len, y: dy / len, len };
}

function coversBox(
  point: { x: number; y: number },
  boxes: { pos: { x: number; y: number }; size: { width: number; height: number } }[],
): boolean {
  return boxes.some(
    (box) =>
      point.x > box.pos.x - BADGE_HALF_X - 4 &&
      point.x < box.pos.x + box.size.width + BADGE_HALF_X + 4 &&
      point.y > box.pos.y - BADGE_HALF_Y - 4 &&
      point.y < box.pos.y + box.size.height + BADGE_HALF_Y + 4,
  );
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
    if (nearSegment(point, a, b, 20) || nearCurve(point, a, bend, b, 20)) return true;
  }
  return false;
}

/** The pill covers a flow pipe or a relation. Pipe-parallel relations are judged on the
 * outer side they are actually drawn on, not on the pipe they were moved off. */
function coversStroke(point: { x: number; y: number }, model: Model, byId: Map<string, Variable>): boolean {
  for (const flow of model.flows) {
    const flowVar = byId.get(flow.id);
    if (!flowVar) continue;
    const fromValve = centerOf(flowVar);
    for (const stockId of [flow.from, flow.to]) {
      if (!stockId) continue;
      const stock = byId.get(stockId);
      if (stock && nearSegment(point, fromValve, centerOf(stock), STROKE_PAD)) return true;
    }
  }
  for (const connector of model.connectors) {
    const from = byId.get(connector.from);
    const to = byId.get(connector.to);
    if (!from || !to) continue;
    const bend = connector.bend;
    const side = bend ? pipeRelationSide(model, connector.from, connector.to) : null;
    // A pipe-parallel relation is drawn from the outer side through its bend. The straight
    // chord between those sides is the node edge, not the arrow, and the box check already
    // keeps the pill off the node. Rejecting that chord would leave no room in the lens.
    if (side && bend) {
      if (nearCurve(point, outerAttachment(from, side), bend, outerAttachment(to, side), STROKE_PAD)) return true;
      continue;
    }
    const a = centerOf(from);
    const b = centerOf(to);
    if (nearSegment(point, a, b, STROKE_PAD)) return true;
    if (bend && nearCurve(point, a, bend, b, STROKE_PAD)) return true;
  }
  return false;
}

function nearCurve(
  point: { x: number; y: number },
  a: { x: number; y: number },
  bend: { x: number; y: number },
  b: { x: number; y: number },
  pad: number,
): boolean {
  for (let step = 1; step <= 7; step++) {
    const t = step / 8;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * bend.x + t * t * b.x;
    const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * bend.y + t * t * b.y;
    if (Math.hypot(x - point.x, y - point.y) < pad) return true;
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
    loop.centroid = parkBadge(loop.centroid, loop.nodeIds, boxes, parked, loop.number, model, byId);
    parked.push(loop.centroid);
  }

  return limited;
}
