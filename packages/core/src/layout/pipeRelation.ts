import { allVariables, type Model, type Position, type Variable } from "../model/types.js";
import { centerOf } from "./geometry.js";

/** A side of a node the canvas can attach an edge to. */
export type DiagramSide = "top" | "right" | "bottom" | "left";

/**
 * A causal link that restates a flow pipe (the stock the pipe already joins to that rate).
 * Drawn on the facing sides, it has to share the pipe's short gap and folds back on itself.
 * Returns the open side of the chain instead, or null when the link is not that pair.
 */
export function pipeRelationSide(model: Model, fromId: string, toId: string): DiagramSide | null {
  const variables = allVariables(model);
  const from = variables.find((variable) => variable.id === fromId);
  const to = variables.find((variable) => variable.id === toId);
  if (!from || !to) return null;
  const flow = model.flows.find((item) => item.id === from.id || item.id === to.id);
  if (!flow) return null;
  const other = flow.id === from.id ? to : from;
  if (flow.from !== other.id && flow.to !== other.id) return null;

  const a = centerOf(from);
  const b = centerOf(to);
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const others = variables.filter((variable) => variable.id !== from.id && variable.id !== to.id);
  if (horizontal) {
    const mid = (a.y + b.y) / 2;
    const band = Math.max(from.size.height, to.size.height) / 2;
    const above = others.filter((variable) => centerOf(variable).y < mid - band).length;
    const below = others.filter((variable) => centerOf(variable).y > mid + band).length;
    // The busier side keeps the causes that already sit there. The link takes the open side.
    return above >= below ? "bottom" : "top";
  }
  const mid = (a.x + b.x) / 2;
  const band = Math.max(from.size.width, to.size.width) / 2;
  const left = others.filter((variable) => centerOf(variable).x < mid - band).length;
  const right = others.filter((variable) => centerOf(variable).x > mid + band).length;
  return left >= right ? "right" : "left";
}

/** Border point on `side`, at the node's center along the other axis. */
export function outerAttachment(variable: Variable, side: DiagramSide): Position {
  const center = centerOf(variable);
  if (side === "bottom") return { x: center.x, y: variable.pos.y + variable.size.height };
  if (side === "top") return { x: center.x, y: variable.pos.y };
  if (side === "right") return { x: variable.pos.x + variable.size.width, y: center.y };
  return { x: variable.pos.x, y: center.y };
}

/** Control point just outside `side`, so a curve between the two outer borders stays off the pipe. */
export function pipeRelationBend(from: Variable, to: Variable, side: DiagramSide, pad = 36): Position {
  const a = centerOf(from);
  const b = centerOf(to);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (side === "bottom") return { x: mid.x, y: Math.max(from.pos.y + from.size.height, to.pos.y + to.size.height) + pad };
  if (side === "top") return { x: mid.x, y: Math.min(from.pos.y, to.pos.y) - pad };
  if (side === "right") return { x: Math.max(from.pos.x + from.size.width, to.pos.x + to.size.width) + pad, y: mid.y };
  return { x: Math.min(from.pos.x, to.pos.x) - pad, y: mid.y };
}
