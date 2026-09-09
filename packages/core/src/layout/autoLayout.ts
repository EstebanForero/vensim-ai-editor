import dagre from "@dagrejs/dagre";
import { loopAnnotationPos, loopLabelOf } from "../loops/annotate.js";
import { detectLoops } from "../loops/detect.js";
import { allVariables, type Model } from "../model/types.js";

export interface AutoLayoutOptions {
  /** "LR" (left-to-right, the default — reads naturally as causal flow) or "TB" (top-to-bottom). */
  direction?: "LR" | "TB";
  /** Horizontal gap between nodes on the same rank. */
  nodeSep?: number;
  /** Vertical gap between ranks. */
  rankSep?: number;
}

/**
 * Re-clusters every stock/flow/auxiliary into a layered layout (via dagre) driven by the same
 * edges used for simulation and loop detection — flow pipes (stock <-> flow) and causal
 * relations (connector from -> to) — so variables that are causally close end up visually
 * close, and the graph reads left-to-right instead of piling up wherever nodes were dropped.
 * A loop's own auto-generated annotation (see loops/annotate.ts) is re-centered on that loop's
 * new centroid — recomputed fresh from the positions this function just assigned — so it stays
 * in the middle of the elements it's actually describing instead of going stale wherever it
 * happened to land before. Every other comment (anything a user wrote by hand) is left in place,
 * only nudged if it now overlaps a repositioned node.
 */
export function autoLayout(model: Model, options: AutoLayoutOptions = {}): void {
  const { direction = "LR", nodeSep = 60, rankSep = 120 } = options;
  const variables = allVariables(model);

  const edges: [string, string][] = [];
  for (const f of model.flows) {
    if (f.from) edges.push([f.from, f.id]);
    if (f.to) edges.push([f.id, f.to]);
  }
  for (const c of model.connectors) edges.push([c.from, c.to]);

  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  // Isolated variables (no flow/relation at all — e.g. a freshly-added constant) have no rank
  // to derive a position from. Dagre also doesn't pack separate disconnected components
  // tightly against each other, so mixing them in can scatter them arbitrarily far from the
  // main graph. Both get a simple packed grid instead, kept clear of the laid-out cluster.
  const connected = variables.filter((v) => (degree.get(v.id) ?? 0) > 0);
  const isolated = variables.filter((v) => (degree.get(v.id) ?? 0) === 0);

  let clusterBottom = 0;
  let clusterLeft = 0;
  if (connected.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: nodeSep, ranksep: rankSep, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const v of connected) g.setNode(v.id, { width: v.size.width, height: v.size.height });
    for (const [a, b] of edges) {
      if (g.hasNode(a) && g.hasNode(b)) g.setEdge(a, b);
    }
    dagre.layout(g);

    for (const v of connected) {
      const n = g.node(v.id);
      if (!n) continue;
      // dagre positions are node centers; the model (and React Flow) use top-left corners.
      v.pos = { x: n.x - v.size.width / 2, y: n.y - v.size.height / 2 };
      clusterBottom = Math.max(clusterBottom, v.pos.y + v.size.height);
      clusterLeft = Math.min(clusterLeft, v.pos.x);
    }
  }

  const gridOriginY = connected.length > 0 ? clusterBottom + rankSep : 0;
  const gridOriginX = connected.length > 0 ? clusterLeft : 0;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(isolated.length)));
  isolated.forEach((v, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    v.pos = { x: gridOriginX + col * (v.size.width + nodeSep), y: gridOriginY + row * (v.size.height + nodeSep) };
  });

  // Recomputed AFTER the layout above, from the positions just assigned — a loop's centroid
  // moves along with its elements, so this must run last, not off whatever centroid detectLoops
  // would have reported before this function touched anything.
  const loopByLabel = new Map(detectLoops(model).map((loop) => [`${loop.polarity}${loop.number}`, loop]));

  for (const c of model.comments) {
    const label = loopLabelOf(c.text);
    const loop = label ? loopByLabel.get(label) : undefined;
    // A loop annotation whose loop still exists gets re-centered on it directly, same as a
    // fresh annotateLoops call would place it — overlap is expected and fine here, this IS the
    // annotation for what's underneath it. Anything else (a stale annotation for a loop that no
    // longer exists, or a genuine user comment) falls back to the ordinary nudge-if-overlapping.
    c.pos = loop ? loopAnnotationPos(loop.centroid) : clearOfLayout(c.pos, model);
  }
}

function clearOfLayout(pos: { x: number; y: number }, model: Model): { x: number; y: number } {
  const overlapping = allVariables(model).some(
    (v) =>
      pos.x < v.pos.x + v.size.width && pos.x + 160 > v.pos.x && pos.y < v.pos.y + v.size.height && pos.y + 60 > v.pos.y,
  );
  if (!overlapping) return pos;
  const maxY = Math.max(0, ...allVariables(model).map((v) => v.pos.y + v.size.height));
  return { x: pos.x, y: maxY + 60 };
}
