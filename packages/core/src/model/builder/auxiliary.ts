import { nextId } from "../ids.js";
import type { Auxiliary, Model, Position, Size } from "../types.js";
import { assertUniqueName } from "./helpers.js";

const DEFAULT_SIZE: Size = { width: 90, height: 45 };

export interface AddAuxiliaryInput {
  name: string;
  equation?: string;
  isConstant?: boolean;
  units?: string;
  comment?: string;
  pos?: Position;
  size?: Size;
}

export function addAuxiliary(model: Model, input: AddAuxiliaryInput): Auxiliary {
  assertUniqueName(model, input.name);
  const aux: Auxiliary = {
    kind: "auxiliary",
    id: nextId("aux"),
    name: input.name,
    equation: input.equation ?? "0",
    isConstant: input.isConstant ?? /^-?\d+(\.\d+)?$/.test(input.equation ?? "0"),
    units: input.units ?? "",
    comment: input.comment ?? "",
    pos: input.pos ?? { x: 0, y: 0 },
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

/** Convenience wrapper: a "constant" is just an auxiliary flagged as such with a numeric equation. */
export function addConstant(model: Model, input: AddConstantInput): Auxiliary {
  const { value, ...rest } = input;
  return addAuxiliary(model, { ...rest, equation: String(value), isConstant: true });
}
