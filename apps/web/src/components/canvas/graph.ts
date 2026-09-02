import { allVariables, type Loop, type Model } from "@vensim-ai/core";
import type { Edge, Node } from "@xyflow/react";

export function buildGraph(
  model: Model,
  selectedId: string | null,
  loops: Loop[],
  editingId: string | null = null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const s of model.stocks) {
    nodes.push({
      id: s.id,
      type: "stock",
      position: s.pos,
      data: { variable: s, selected: s.id === selectedId, editing: s.id === editingId },
    });
  }
  for (const f of model.flows) {
    nodes.push({
      id: f.id,
      type: "flow",
      position: f.pos,
      data: { variable: f, selected: f.id === selectedId, editing: f.id === editingId },
    });
    if (f.from) {
      edges.push({
        id: `pipe-${f.id}-from`,
        source: f.from,
        target: f.id,
        type: "straight",
        style: { stroke: "var(--flow-color)", strokeWidth: 3 },
        markerEnd: { type: "arrowclosed" as const, color: "var(--flow-color)" },
      });
    }
    if (f.to) {
      edges.push({
        id: `pipe-${f.id}-to`,
        source: f.id,
        target: f.to,
        type: "straight",
        style: { stroke: "var(--flow-color)", strokeWidth: 3 },
        markerEnd: { type: "arrowclosed" as const, color: "var(--flow-color)" },
      });
    }
  }
  for (const a of model.auxiliaries) {
    nodes.push({
      id: a.id,
      type: "aux",
      position: a.pos,
      data: { variable: a, selected: a.id === selectedId, editing: a.id === editingId },
    });
  }
  for (const c of model.connectors) {
    const isSelected = c.id === selectedId;
    edges.push({
      id: c.id,
      source: c.from,
      target: c.to,
      type: "relation",
      style: {
        stroke: "var(--connector-color)",
        strokeWidth: isSelected ? 2.5 : 1,
        strokeDasharray: "4 2",
      },
      markerEnd: { type: "arrow" as const, color: "var(--connector-color)" },
      data: { connector: c },
    });
  }

  for (const c of model.comments) {
    nodes.push({
      id: c.id,
      type: "comment",
      position: c.pos,
      style: { width: c.size.width, height: c.size.height },
      data: { comment: c, selected: c.id === selectedId, editing: c.id === editingId },
    });
  }

  const nameById = new Map(allVariables(model).map((v) => [v.id, v.name]));
  for (const loop of loops) {
    nodes.push({
      id: loop.id,
      type: "loop",
      position: loop.centroid,
      draggable: false,
      selectable: false,
      zIndex: 1000,
      data: { loop, names: loop.nodeIds.map((id) => nameById.get(id) ?? id) },
    });
  }

  return { nodes, edges };
}

export function idsOf(model: Model): Set<string> {
  return new Set([...allVariables(model).map((v) => v.id), ...model.connectors.map((c) => c.id)]);
}
