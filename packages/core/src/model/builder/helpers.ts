import { ModelError } from "../errors.js";
import { allVariables, findVariable, findVariableByName, type Model, type Variable } from "../types.js";

export function assertUniqueName(model: Model, name: string, ignoreId?: string): void {
  const existing = findVariableByName(model, name);
  if (existing && existing.id !== ignoreId) {
    throw new ModelError(`A variable named "${name}" already exists.`);
  }
}

export function resolveVariableRef(model: Model, ref: string): Variable {
  const byId = findVariable(model, ref);
  if (byId) return byId;
  const byName = findVariableByName(model, ref);
  if (byName) return byName;
  throw new ModelError(`No variable found matching "${ref}".`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary rename of every reference to `oldName` inside equation text, across the whole model. */
export function renameReferencesInEquations(model: Model, oldName: string, newName: string): void {
  const needsQuoting = /[^A-Za-z0-9_]/.test(newName);
  const replacement = needsQuoting ? `"${newName}"` : newName;
  const pattern = new RegExp(`(?<!["\\w])${escapeRegExp(oldName)}(?!["\\w])`, "g");
  for (const v of allVariables(model)) {
    if ("equation" in v && v.equation) v.equation = v.equation.replace(pattern, replacement);
    if ("initialEquation" in v && v.initialEquation) {
      v.initialEquation = v.initialEquation.replace(pattern, replacement);
    }
  }
}
