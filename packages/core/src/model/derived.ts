// Queries computed from a Model's existing data, rather than stored fields — kept separate
// from types.ts (the schema) so derived facts can't drift out of sync with what they're
// derived from. isConstantAuxiliary is the first of these: whether an Auxiliary "is a
// constant" is never stored, only computed from its equation on demand.

import { collectVarNames, tryParseExpr } from "../mdl/expr/index.js";
import { allVariables, type Auxiliary, type Model } from "./types.js";

/**
 * An Auxiliary behaves as a constant when its equation references no other variable — a bare
 * number, or an expression built only from literals/functions of literals. This mirrors
 * Vensim, which doesn't have a distinct "Constant" diagram element either: whether something
 * reads as a constant falls out of its equation, not a separate kind you have to pick when
 * creating it.
 */
export function isConstantAuxiliary(aux: Auxiliary, model?: Model): boolean {
  const knownNames = model ? allVariables(model).map((v) => v.name) : [];
  const parsed = tryParseExpr(aux.equation, knownNames);
  if (!parsed) return false;
  return collectVarNames(parsed).size === 0;
}
