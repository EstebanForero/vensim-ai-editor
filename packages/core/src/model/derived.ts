// Queries computed from a Model's existing data, rather than stored fields — kept separate
// from types.ts (the schema) so derived facts can't drift out of sync with what they're
// derived from. isConstantAuxiliary is the first of these: whether an Auxiliary "is a
// constant" is never stored, only computed from its equation on demand.

import { collectVarNames, tryParseExpr } from "../mdl/expr/index.js";
import { allVariables, findVariable, type Auxiliary, type Model, type Variable } from "./types.js";

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

function ownEquation(variable: Variable): string {
  return variable.kind === "stock" ? variable.initialEquation : variable.equation;
}

/** Every variable this one's equation (or initial value, for a stock) directly references —
 * "what does this depend on". */
export function equationDependencies(model: Model, variable: Variable): Variable[] {
  const knownNames = allVariables(model)
    .map((v) => v.name)
    .filter((n) => n !== variable.name);
  const parsed = tryParseExpr(ownEquation(variable), knownNames);
  if (!parsed) return [];
  const names = collectVarNames(parsed);
  return allVariables(model).filter((v) => names.has(v.name));
}

/** Every variable whose equation directly references this one — "what depends on this". Only
 * equations are consulted here (not causal-relation arrows, which the inspector reports
 * separately) since a relation can exist for annotation purposes without necessarily being the
 * thing making a value flow. */
export function equationDependents(model: Model, variable: Variable): Variable[] {
  return allVariables(model).filter((v) => v.id !== variable.id && equationDependencies(model, v).some((d) => d.id === variable.id));
}

export interface VariableRelationships {
  /** Variables this one's equation references, plus variables a relation arrow points from. */
  dependsOn: Variable[];
  /** Variables whose equation references this one, plus variables a relation arrow points to. */
  usedBy: Variable[];
  isConstant: boolean;
}

/** The "smart inspector" view of a variable: what it depends on and what depends on it, from
 * both its equation and any explicit causal-relation arrows, deduplicated. */
export function variableRelationships(model: Model, variableId: string): VariableRelationships {
  const variable = findVariable(model, variableId);
  if (!variable) return { dependsOn: [], usedBy: [], isConstant: false };

  const dependsOn = new Map<string, Variable>();
  const usedBy = new Map<string, Variable>();
  for (const v of equationDependencies(model, variable)) dependsOn.set(v.id, v);
  for (const v of equationDependents(model, variable)) usedBy.set(v.id, v);
  for (const c of model.connectors) {
    if (c.to === variable.id) {
      const v = findVariable(model, c.from);
      if (v) dependsOn.set(v.id, v);
    }
    if (c.from === variable.id) {
      const v = findVariable(model, c.to);
      if (v) usedBy.set(v.id, v);
    }
  }

  return {
    dependsOn: [...dependsOn.values()],
    usedBy: [...usedBy.values()],
    isConstant: variable.kind === "auxiliary" ? isConstantAuxiliary(variable, model) : false,
  };
}
