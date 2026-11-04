import dagre from "@dagrejs/dagre";
import { allVariables, type Model } from "../model/types.js";
import { boxesOverlap } from "./geometry.js";
import { finalizeLayout } from "./finalize.js";
import type { AutoLayoutOptions } from "./types.js";

/**
 * The original layout. Dagre ranks every stock, flow, and auxiliary together from the flow
 * pipes and the causal relations, then pulls each flow onto its stock's line when that does
 * not stack two flows. Kept as an algorithm of its own so a caller can still ask for it.
 */
export function layeredLayout(model: Model, options: AutoLayoutOptions = {}): void {
  const { direction = "LR", nodeSep = 60, rankSep = 120 } = options;
  for (const connector of model.connectors) connector.bend = null;

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
  const connected = variables.filter((v) => (degree.get(v.id) ?? 0) > 0);

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
      v.pos = { x: n.x - v.size.width / 2, y: n.y - v.size.height / 2 };
    }

    const perpAxis = direction === "LR" ? "y" : "x";
    const perpSize = direction === "LR" ? "height" : "width";
    for (const flow of model.flows) {
      const fromStock = flow.from ? model.stocks.find((s) => s.id === flow.from) : undefined;
      const toStock = flow.to ? model.stocks.find((s) => s.id === flow.to) : undefined;
      const centers = [fromStock, toStock]
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => s.pos[perpAxis] + s.size[perpSize] / 2);
      if (centers.length === 0) continue;
      if (centers.length === 2 && Math.abs(centers[0]! - centers[1]!) > 4) {
        if (!fromStock) continue;
        centers.length = 1;
        centers[0] = fromStock.pos[perpAxis] + fromStock.size[perpSize] / 2;
      }
      const target = centers.reduce((s, c) => s + c, 0) / centers.length;
      const snapped = { ...flow.pos, [perpAxis]: target - flow.size[perpSize] / 2 };
      const box = { pos: snapped, size: flow.size };
      const collides = allVariables(model).some((v) => v.id !== flow.id && boxesOverlap(box, { pos: v.pos, size: v.size }));
      if (!collides) flow.pos = snapped;
    }
  }

  finalizeLayout(model, { nodeSep, rankSep, placedIds: new Set(connected.map((v) => v.id)) });
}
