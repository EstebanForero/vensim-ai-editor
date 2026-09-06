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
    // Matches Vensim's own default rate/flow label box size (confirmed against a flow drawn
    // fresh in a real Vensim session, not just an example file — see writer.ts's valve-label
    // pairing notes for why this specific size turned out to matter for more than looks).
    size: input.size ?? { width: 92, height: 52 },
    from: fromId,
    to: toId,
  };
  model.flows.push(flow);
  if (fromId) findStockOrThrow(model, fromId).outflows.push(flow.id);
  if (toId) findStockOrThrow(model, toId).inflows.push(flow.id);
  return flow;
}

function findFlowOrThrow(model: Model, id: string): Flow {
  const f = model.flows.find((x) => x.id === id);
  if (!f) throw new ModelError(`Flow ${id} not found.`);
  return f;
}

/** Re-points one end ("from" or "to") of an existing flow at a different stock, or clears it
 * to a cloud with `null` — keeping the flow's own `from`/`to` fields and the stocks'
 * `inflows`/`outflows` arrays consistent with each other, the same invariant `addFlow` and
 * `deleteElement` already maintain. This is the flow's connection made editable after the
 * fact — until now the only way to change it was to delete and recreate the flow, and the only
 * way to *see* it was the raw equation text, which is why a mis-wired or orphaned flow (both
 * ends null) was hard to notice or fix from the canvas/inspector alone. */
export function setFlowEndpoint(model: Model, flowId: string, which: "from" | "to", stockRef: string | null): Flow {
  const flow = findFlowOrThrow(model, flowId);
  const newStockId = resolveStockRef(model, stockRef);
  const oldStockId = flow[which];
  if (newStockId === oldStockId) return flow;

  const otherEnd = which === "from" ? flow.to : flow.from;
  if (!newStockId && !otherEnd) {
    throw new ModelError(`Flow "${flow.name}" must connect to at least one stock (from and/or to).`);
  }

  if (oldStockId) {
    const oldStock = findStockOrThrow(model, oldStockId);
    const list = which === "from" ? oldStock.outflows : oldStock.inflows;
    const idx = list.indexOf(flow.id);
    if (idx !== -1) list.splice(idx, 1);
  }
  if (newStockId) {
    const newStock = findStockOrThrow(model, newStockId);
    const list = which === "from" ? newStock.outflows : newStock.inflows;
    list.push(flow.id);
  }
  flow[which] = newStockId;
  return flow;
}
