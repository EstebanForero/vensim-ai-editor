import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import type { Flow, Model, Position, Size } from "../types.js";
import { assertUniqueName } from "./helpers.js";
import { findStockOrThrow } from "./stock.js";

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
    pos: input.pos ?? { x: 0, y: 0 },
    size: input.size ?? { width: 70, height: 30 },
    from: fromId,
    to: toId,
  };
  model.flows.push(flow);
  if (fromId) findStockOrThrow(model, fromId).outflows.push(flow.id);
  if (toId) findStockOrThrow(model, toId).inflows.push(flow.id);
  return flow;
}
