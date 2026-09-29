import { ModelError } from "../errors.js";
import {
  allVariables,
  findVariable,
  findVariableByName,
  isReservedName,
  RESERVED_NAMES,
  type Model,
  type Position,
  type Variable,
} from "../types.js";

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
  const slot = (i: number) => ({ x: 120 + (i % 6) * 160, y: 120 + Math.floor(i / 6) * 110 });

  // Walk the grid until a slot is actually clear, rather than taking the one the count happens to
  // name. The count is only a starting guess, and it is a bad one as soon as anything has moved
  // the model somewhere else: after an `autoLayout` — which repositions everything absolutely,
  // from the diagram's own origin — the slot that count names is already occupied, so the new
  // element was drawn underneath an existing one and the report was "I added a variable and I
  // cannot see it". Which is the exact thing this function exists to prevent, one layout call
  // away from not doing it.
  const placed: { pos: Position; size: { width: number; height: number } }[] = [...allVariables(model), ...model.comments];
  for (let i = count; i < count + 1000; i++) {
    const position = slot(i);
    const clear = !placed.some(
      (e) =>
        position.x < e.pos.x + e.size.width &&
        e.pos.x < position.x + 160 &&
        position.y < e.pos.y + e.size.height &&
        e.pos.y < position.y + 110,
    );
    if (clear) return position;
  }

  // A thousand slots is far past any real diagram; if every one is taken, restarting the grid is
  // better than refusing to place the element at all.
  return slot(count);
}

/** Strips accents/diacritics (e.g. "Recepción" -> "Recepcion") — applied at every point free
 * text enters the model (a variable's name, its equation text, units, comment; a freestanding
 * comment's text), not just at .mdl export time. An accented name is completely valid Vensim
 * syntax on its own, but this editor hit a real, live-Vensim-confirmed bug from it: a name
 * referenced with an accent from a DIFFERENT variable's equation, while its own definition line
 * (or some other reference to the same name) ended up spelled without one — two different
 * strings, which Vensim treats as two different variables, one of them an undefined "shadow"
 * silently carrying the actual connection while the real box sits unwired (see mdl/writer.ts's
 * mdlSafeName/rewriteEquationRefs, which patched this at export time after the fact). Stripping
 * at the source instead means every copy of a name — however many places it gets typed or
 * referenced, by a user or the AI — is the same ASCII string from the moment it exists, so this
 * exact class of mismatch can't happen at all, and the export-time version becomes a no-op
 * safety net rather than the only line of defense. */
export function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function assertUniqueName(model: Model, name: string, ignoreId?: string): void {
  // Checked here rather than at each call site because every creation and rename path routes
  // through this one function — that's the whole point of it. See RESERVED_NAMES for why these
  // particular names can't be taken (a variable called "Time" silently replaces the clock every
  // equation is evaluated against).
  if (isReservedName(name)) {
    const reserved = RESERVED_NAMES.find((r) => r.toLowerCase() === name.trim().toLowerCase())!;
    throw new ModelError(
      `"${reserved}" is reserved by Vensim and can't be used as a variable name.` +
        (reserved === "Time"
          ? " Time is the model's built-in clock — you can already use it in any equation."
          : " It's one of the simulation control parameters."),
    );
  }
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

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A regex matching every reference to `name` inside equation text — quoted or bare — without
 * matching a partial word or a name that's merely a substring of a longer identifier. Shared by
 * a real rename (renameReferencesInEquations, below) and by the .mdl writer's own accent
 * normalization (mdl/writer.ts's rewriteEquationRefs), which both need to find every occurrence
 * of a name inside arbitrary equation text, not just ones already wrapped in quotes — an
 * equation can reference a multi-word or accented name completely unquoted (this editor's own
 * parser tolerates it, matching known variable names contextually), so a quoted-only search
 * misses exactly that case. */
export function referencePattern(name: string): RegExp {
  return new RegExp(`(?<!["\\w])${escapeRegExp(name)}(?!["\\w])`, "g");
}

/** Word-boundary rename of every reference to `oldName` inside equation text, across the whole model. */
export function renameReferencesInEquations(model: Model, oldName: string, newName: string): void {
  const needsQuoting = /[^A-Za-z0-9_]/.test(newName);
  const replacement = needsQuoting ? `"${newName}"` : newName;
  const pattern = referencePattern(oldName);
  for (const v of allVariables(model)) {
    if ("equation" in v && v.equation) v.equation = v.equation.replace(pattern, replacement);
    if ("initialEquation" in v && v.initialEquation) {
      v.initialEquation = v.initialEquation.replace(pattern, replacement);
    }
  }
}
