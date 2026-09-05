import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import type { Model, Position, Size, Stock } from "../types.js";
import { assertUniqueName, autoPlacePosition } from "./helpers.js";

const DEFAULT_SIZE: Size = { width: 90, height: 45 };

export interface AddStockInput {
  name: string;
  initialEquation?: string;
  units?: string;
  comment?: string;
  pos?: Position;
  size?: Size;
}

export function addStock(model: Model, input: AddStockInput): Stock {
  assertUniqueName(model, input.name);
  const stock: Stock = {
    kind: "stock",
    id: nextId("stock"),
    name: input.name,
    initialEquation: input.initialEquation ?? "0",
    units: input.units ?? "",
    comment: input.comment ?? "",
    pos: input.pos ?? autoPlacePosition(model),
    size: input.size ?? DEFAULT_SIZE,
    inflows: [],
    outflows: [],
  };
  model.stocks.push(stock);
  return stock;
}

export function findStockOrThrow(model: Model, id: string): Stock {
  const s = model.stocks.find((x) => x.id === id);
  if (!s) throw new ModelError(`Stock ${id} not found.`);
  return s;
}
