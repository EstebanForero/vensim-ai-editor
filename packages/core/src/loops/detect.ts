import { allVariables, type Model } from "../model/types.js";
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

/** Nudges a badge position that landed on top of one of its own loop's nodes (common for
 * short 2-node loops, where the centroid is just the midpoint between two nearby nodes) out
 * to a nearby clear spot, spread deterministically by loop index so badges sharing a
 * collision point don't stack on each other either. */
function clearOfNodes(centroid: { x: number; y: number }, points: { x: number; y: number }[], index: number): { x: number; y: number } {
  // `points` are node top-left corners (React Flow's convention), not centers, and labels can
  // be visually wide — use a generous clearance radius so the badge doesn't sit under a label.
  const minDist = Math.min(...points.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y)));
  if (minDist > 70) return centroid;
  const angle = ((index * 47) % 360) * (Math.PI / 180);
  return { x: centroid.x + Math.cos(angle) * 60, y: centroid.y + Math.sin(angle) * 60 - 40 };
}

export function detectLoops(model: Model, options: DetectLoopsOptions = {}): Loop[] {
  const { maxLength = 8, maxCycles = 60, limit = 24 } = options;
  const adjacency = buildSignedGraph(model);
  const posById = new Map(allVariables(model).map((v) => [v.id, v.pos]));

  const raw = findElementaryCycles(adjacency, maxLength, maxCycles);

  const loops: Loop[] = raw.map((cycle, i) => {
    const negativeCount = cycle.signs.filter((s) => s === -1).length;
    const points = cycle.nodeIds.map((id) => posById.get(id) ?? { x: 0, y: 0 });
    const rawCentroid = {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
    return {
      id: `loop_${cycle.nodeIds.join("_")}_${i}`,
      nodeIds: cycle.nodeIds,
      polarity: negativeCount % 2 === 0 ? "R" : "B",
      direction: loopDirection(points),
      centroid: clearOfNodes(rawCentroid, points, i),
    };
  });

  loops.sort((a, b) => a.nodeIds.length - b.nodeIds.length);
  return loops.slice(0, limit);
}
