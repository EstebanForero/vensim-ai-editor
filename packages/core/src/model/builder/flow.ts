import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import type { Flow, Model, Position, Size } from "../types.js";
import { assertUniqueName, autoPlacePosition } from "./helpers.js";
import { findStockOrThrow } from "./stock.js";

/** Halfway between whichever stock(s) this flow connects to (offset to one side of a single
 * stock, for a cloud-source/sink flow), so a flow an AI creates without an explicit position
 * lands visibly next to the stock(s) it actually belongs to instead of piling at the origin or
 * a generic grid slot unrelated to its connections. */
function defaultFlowPosition(model: Model, fromId: string | null, toId: string | null): Position {
  const fromStock = fromId ? model.stocks.find((s) => s.id === fromId) : undefined;
  const toStock = toId ? model.stocks.find((s) => s.id === toId) : undefined;
  if (fromStock && toStock) {
    return { x: (fromStock.pos.x + toStock.pos.x) / 2 + 40, y: (fromStock.pos.y + toStock.pos.y) / 2 };
  }
  const anchor = fromStock ?? toStock;
  if (anchor) return { x: anchor.pos.x + (fromStock ? 160 : -100), y: anchor.pos.y };
  return autoPlacePosition(model);
}

export interface AddFlowInput {
  name: string;
  equation?: string;
  /** Stock id or stock name to drain, or null/omitted for a cloud source. */
  from?: string | null;
  /** Stock id or stock name to fill, or null/omitted for a cloud sink. */
  to?: string | null;
  units?: string;
  comment?: string;
  pos?: Position;
  size?: Size;
}

function resolveStockRef(model: Model, ref: string | null | undefined): string | null {
  if (!ref) return null;
  const byId = model.stocks.find((s) => s.id === ref);
  if (byId) return byId.id;
  const byName = model.stocks.find((s) => s.name.toLowerCase() === ref.toLowerCase());
  if (byName) return byName.id;
  throw new ModelError(`No stock found matching "${ref}".`);
}

export function addFlow(model: Model, input: AddFlowInput): Flow {
  assertUniqueName(model, input.name);
  const fromId = resolveStockRef(model, input.from);
  const toId = resolveStockRef(model, input.to);
  if (!fromId && !toId) {
    throw new ModelError(`Flow "${input.name}" must connect to at least one stock (from and/or to).`);
  }
  const flow: Flow = {
    kind: "flow",
    id: nextId("flow"),
    name: input.name,
    equation: input.equation ?? "0",
    units: input.units ?? "",
    comment: input.comment ?? "",
    pos: input.pos ?? defaultFlowPosition(model, fromId, toId),
    size: input.size ?? { width: 70, height: 30 },
    from: fromId,
    to: toId,
  };
  model.flows.push(flow);
  if (fromId) findStockOrThrow(model, fromId).outflows.push(flow.id);
  if (toId) findStockOrThrow(model, toId).inflows.push(flow.id);
  return flow;
}
