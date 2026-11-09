import {
  allVariables,
  findVariable,
  LOOP_BADGE_SIZE,
  lookupTableOf,
  pipeRelationSide,
  type Connector,
  type Loop,
  type Model,
  type Position as ModelPosition,
  type Size,
} from "@vensim-ai/core";
import type { Edge, Node } from "@xyflow/react";
import { closestSides, sourceHandleId, targetHandleId, type Side } from "./edgeRouting";

type Box = { pos: ModelPosition; size: Size };

function routedHandles(a: Box, b: Box): { sourceHandle: string; targetHandle: string } {
  const { from, to } = closestSides(a, b);
  return { sourceHandle: sourceHandleId(from), targetHandle: targetHandleId(to) };
}

/**
 * A link that restates a pipe is drawn from the open side of both nodes when the layout
 * parked its bend there. Both ends use that same side, so the arrow runs beside the chain
 * instead of through the pipe's gap. Any other bend keeps the closest-side handles.
 */
function relationHandles(model: Model, connector: Connector, from: Box, to: Box): { sourceHandle: string; targetHandle: string } {
  const side = pipeRelationSide(model, connector.from, connector.to);
  if (side && connector.bend && bendIsOutside(connector.bend, from, to, side)) {
    return { sourceHandle: sourceHandleId(side), targetHandle: targetHandleId(side) };
  }
  return routedHandles(from, to);
}

function bendIsOutside(bend: ModelPosition, from: Box, to: Box, side: Side): boolean {
  if (side === "bottom") return bend.y >= Math.max(from.pos.y + from.size.height, to.pos.y + to.size.height) - 1;
  if (side === "top") return bend.y <= Math.min(from.pos.y, to.pos.y) + 1;
  if (side === "right") return bend.x >= Math.max(from.pos.x + from.size.width, to.pos.x + to.size.width) - 1;
  return bend.x <= Math.min(from.pos.x, to.pos.x) + 1;
}

export function buildGraph(
  model: Model,
  selectedId: string | null,
  loops: Loop[],
  editingId: string | null = null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Comments first, so they are drawn *underneath* the model. React Flow stacks nodes in array
  // order, and a comment is a filled box the size of a paragraph — put on top, an annotation
  // covers the very variables it is annotating and the report is "I cannot see some variables",
  // which is exactly what a loop annotation placed at its loop's centroid does. Underneath, the
  // worst a comment can do is be partly hidden itself, which is the right way round: the model is
  // the thing you came to look at and the note is the thing you can move.
  for (const c of model.comments) {
    nodes.push({
      id: c.id,
      type: "comment",
      position: c.pos,
      style: { width: c.size.width, height: c.size.height },
      data: { comment: c, selected: c.id === selectedId, editing: c.id === editingId },
    });
  }


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
    const handles = from && to ? relationHandles(model, c, from, to) : { sourceHandle: sourceHandleId("right"), targetHandle: targetHandleId("left") };
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

  const nameById = new Map(allVariables(model).map((v) => [v.id, v.name]));
  for (const loop of loops) {
    nodes.push({
      id: loop.id,
      type: "loop",
      // The centroid is the badge's center. React Flow places a node by its top-left.
      position: { x: loop.centroid.x - LOOP_BADGE_SIZE.width / 2, y: loop.centroid.y - LOOP_BADGE_SIZE.height / 2 },
      style: { width: LOOP_BADGE_SIZE.width, height: LOOP_BADGE_SIZE.height },
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
