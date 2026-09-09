import { nextId } from "../ids.js";
import type { Auxiliary, Model, Position, Size } from "../types.js";
import { assertUniqueName, autoPlacePosition, stripDiacritics } from "./helpers.js";

const DEFAULT_SIZE: Size = { width: 90, height: 45 };

export interface AddAuxiliaryInput {
  name: string;
  equation?: string;
  units?: string;
  comment?: string;
  pos?: Position;
  size?: Size;
}

export function addAuxiliary(model: Model, input: AddAuxiliaryInput): Auxiliary {
  const name = stripDiacritics(input.name);
  assertUniqueName(model, name);
  const aux: Auxiliary = {
    kind: "auxiliary",
    id: nextId("aux"),
    name,
    equation: stripDiacritics(input.equation ?? "0"),
    units: stripDiacritics(input.units ?? ""),
    comment: stripDiacritics(input.comment ?? ""),
    pos: input.pos ?? autoPlacePosition(model),
    size: input.size ?? DEFAULT_SIZE,
  };
  model.auxiliaries.push(aux);
  return aux;
}

export interface AddConstantInput {
  name: string;
  value: number;
  units?: string;
  comment?: string;
  pos?: Position;
  size?: Size;
}

/** Ergonomic convenience for creating an auxiliary with a plain numeric equation — no
 * separate "Constant" element kind is stored; see isConstantAuxiliary in ../derived.ts. */
export function addConstant(model: Model, input: AddConstantInput): Auxiliary {
  const { value, ...rest } = input;
  return addAuxiliary(model, { ...rest, equation: String(value) });
}
