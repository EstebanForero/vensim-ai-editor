import { ModelError } from "../errors.js";
import { nextId } from "../ids.js";
import type { Model, Position, Size, Stock } from "../types.js";
import { assertUniqueName, autoPlacePosition, stripDiacritics } from "./helpers.js";

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
  const name = stripDiacritics(input.name);
  assertUniqueName(model, name);
  const stock: Stock = {
    kind: "stock",
    id: nextId("stock"),
    name,
    initialEquation: stripDiacritics(input.initialEquation ?? "0"),
    units: stripDiacritics(input.units ?? ""),
    comment: stripDiacritics(input.comment ?? ""),
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
