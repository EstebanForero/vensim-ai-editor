import { allVariables, findVariable, lookupTableOf, type Loop, type Model, type Position as ModelPosition, type Size } from "@vensim-ai/core";
import type { Edge, Node } from "@xyflow/react";
import { closestSides, sourceHandleId, targetHandleId } from "./edgeRouting";

type Box = { pos: ModelPosition; size: Size };

function routedHandles(a: Box, b: Box): { sourceHandle: string; targetHandle: string } {
  const { from, to } = closestSides(a, b);
  return { sourceHandle: sourceHandleId(from), targetHandle: targetHandleId(to) };
}

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
      const fromStock = findVariable(model, f.from);
      const handles = fromStock ? routedHandles(fromStock, f) : { sourceHandle: sourceHandleId("right"), targetHandle: targetHandleId("left") };
      edges.push({
        id: `pipe-${f.id}-from`,
        source: f.from,
        target: f.id,
        ...handles,
        type: "pipe",
        style: { stroke: "var(--flow-color)", strokeWidth: 3 },
        markerEnd: { type: "arrowclosed" as const, color: "var(--flow-color)" },
      });
    }
    if (f.to) {
      const toStock = findVariable(model, f.to);
      const handles = toStock ? routedHandles(f, toStock) : { sourceHandle: sourceHandleId("right"), targetHandle: targetHandleId("left") };
      edges.push({
        id: `pipe-${f.id}-to`,
        source: f.id,
        target: f.to,
        ...handles,
        type: "pipe",
        style: { stroke: "var(--flow-color)", strokeWidth: 3 },
        markerEnd: { type: "arrowclosed" as const, color: "var(--flow-color)" },
      });
    }
  }
  for (const a of model.auxiliaries) {
    // A lookup gets its own node type so the canvas can draw its curve — it's still an
    // auxiliary in the model (see core's model/lookup.ts), just one worth showing the shape of.
    const table = lookupTableOf(a, model);
    nodes.push({
      id: a.id,
      type: table ? "lookup" : "aux",
      position: a.pos,
      data: table
        ? { variable: a, table, selected: a.id === selectedId, editing: a.id === editingId }
        : { variable: a, selected: a.id === selectedId, editing: a.id === editingId },
    });
  }
  for (const c of model.connectors) {
    const isSelected = c.id === selectedId;
    const from = findVariable(model, c.from);
    const to = findVariable(model, c.to);
    const handles = from && to ? routedHandles(from, to) : { sourceHandle: sourceHandleId("right"), targetHandle: targetHandleId("left") };
    edges.push({
      id: c.id,
      source: c.from,
      target: c.to,
      ...handles,
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
