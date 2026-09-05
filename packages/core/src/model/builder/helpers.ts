import { ModelError } from "../errors.js";
import { allVariables, findVariable, findVariableByName, type Model, type Position, type Variable } from "../types.js";

/**
 * A non-overlapping spot for a new element when no explicit position is given — which is the
 * common case for AI-created elements (an AI has no reason to compute sensible diagram
 * coordinates unless asked to lay the diagram out). Without this, every element defaulted to a
 * flat `{x:0,y:0}`, so a model built through several tool calls piled every single element
 * exactly on top of the others at the origin until something (auto_layout, or a manual drag)
 * spread them out — which reads as "the position is wrong, then later changes" the moment that
 * happens. A simple advancing grid, keyed off how many elements already exist, is enough to
 * keep newly-added elements visibly distinct immediately, the same way the toolbar's own
 * manually-placed buttons already behaved before this was centralized here.
 */
export function autoPlacePosition(model: Model): Position {
  const count = allVariables(model).length + model.comments.length;
  const col = count % 6;
  const row = Math.floor(count / 6);
  return { x: 120 + col * 160, y: 120 + row * 110 };
}

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
