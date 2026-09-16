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
    }

    // dagre optimizes the WHOLE graph's crossing/barycenter, blending flow-pipe edges and causal-
    // relation edges together — a flow pulled on by an unrelated causal relation can land off the
    // straight line to its own stock(s) even though nothing else required that, reading as an
    // unnecessarily kinked pipe. Only the flow (never the stock, which stays a more stable anchor
    // other things are laid out relative to) is nudged onto the perpendicular axis its stock(s)
    // already sit on: the shared value when both ends are real stocks on the same line already
    // (the common case), or straight onto the one real stock when the other end is an open cloud.
    // Two DIFFERENT stocks on two different lines can't both be satisfied by moving the flow
    // alone — that's a real layout tradeoff dagre already made, not something to fight here.
    const perpAxis = direction === "LR" ? "y" : "x";
    const perpSize = direction === "LR" ? "height" : "width";
    for (const flow of model.flows) {
      const fromStock = flow.from ? model.stocks.find((s) => s.id === flow.from) : undefined;
      const toStock = flow.to ? model.stocks.find((s) => s.id === flow.to) : undefined;
      const centers = [fromStock, toStock]
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => s.pos[perpAxis] + s.size[perpSize] / 2);
      if (centers.length === 0) continue;
      // Both ends real stocks but on visibly different lines: leave the flow where dagre put it
      // rather than force a line that matches neither.
      if (centers.length === 2 && Math.abs(centers[0]! - centers[1]!) > 4) continue;
      const target = centers.reduce((s, c) => s + c, 0) / centers.length;
      flow.pos = { ...flow.pos, [perpAxis]: target - flow.size[perpSize] / 2 };
    }

    for (const v of connected) {
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

  // A genuine (non-loop-annotation) comment previously only got nudged if it happened to already
  // overlap a node — anywhere clear of the diagram was left alone, including a spot the just-
  // relaid-out diagram was about to expand into, or simply scattered among the nodes rather than
  // set apart from them. Now every such comment is packed into its own column to the right of the
  // whole laid-out cluster, guaranteed clear of every stock/flow/auxiliary, not just wherever it
  // used to be.
  const clusterRight = connected.length > 0 || isolated.length > 0 ? Math.max(0, ...allVariables(model).map((v) => v.pos.x + v.size.width)) : 0;
  let commentColumnY = 0;
  const commentColumnX = clusterRight + rankSep;

  for (const c of model.comments) {
    const label = loopLabelOf(c.text);
    const loop = label ? loopByLabel.get(label) : undefined;
    if (loop) {
      // A loop annotation whose loop still exists gets re-centered on it directly, same as a
      // fresh annotateLoops call would place it — overlap with the loop's own elements is
      // expected and fine here, this IS the annotation for what's underneath it.
      c.pos = loopAnnotationPos(loop.centroid);
      continue;
    }
    // A stale loop annotation (its loop no longer exists) or a genuine user comment: set apart
    // in the dedicated column, stacked top-to-bottom.
    c.pos = { x: commentColumnX, y: commentColumnY };
    commentColumnY += c.size.height + nodeSep;
  }
}
