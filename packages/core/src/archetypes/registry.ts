// The archetype table, and the driver that reports against it.
//
// This is the one place an archetype is declared. Adding a seventh is a detector in detectors.ts,
// an example in examples.ts, and one row here — everything downstream (report order, labels,
// the meanings shown beside each result, the example offered to open) reads from this table, and
// `ArchetypeId` is derived from it, so the UI's own per-archetype maps are compile-checked for
// exhaustiveness against it.

import { buildContext, type ArchetypeContext, type Evidence } from "./context.js";
import {
  escalation,
  fixesThatFail,
  limitsToGrowth,
  shiftingTheBurden,
  successToTheSuccessful,
  tragedyOfTheCommons,
} from "./detectors.js";
import { buildArchetypeExample } from "./examples.js";
import { detectLoops } from "../loops/detect.js";
import type { Model } from "../model/types.js";
import type { ArchetypeMatch, DetectArchetypesOptions } from "./types.js";

export interface ArchetypeDefinition {
  id: string;
  /** The archetype's canonical name, e.g. "Limits to Growth". */
  label: string;
  /**
   * What the pattern means, in one sentence — the interpretation the match summaries
   * deliberately leave out. A summary says what the model contains; this says what that
   * structure does. Kept here rather than in the UI because it is knowledge about the archetype,
   * not about how to draw it.
   */
  meaning: string;
  detect: (ctx: ArchetypeContext) => Evidence[];
  buildExample: () => Model;
}

/**
 * Every archetype, in the order they're reported. Declaration order is the only ordering — there
 * is no separate list to keep in step, which is what a previous version got wrong: it named the
 * archetypes in a hand-maintained array that TypeScript did not check, so forgetting an entry
 * there meant a detector that silently never ran.
 */
export const ARCHETYPES = [
  {
    id: "limits-to-growth",
    label: "Limits to Growth",
    meaning:
      "Growth is real, but a constraint tightens as it grows — so the reinforcing loop slows and the state levels off instead of continuing.",
    detect: limitsToGrowth,
    buildExample: () => buildArchetypeExample("limits-to-growth"),
  },
  {
    id: "tragedy-of-the-commons",
    label: "Tragedy of the Commons",
    meaning:
      "Each user's draw on a shared resource looks harmless on its own; together the loops deplete it, and no single one is the cause.",
    detect: tragedyOfTheCommons,
    buildExample: () => buildArchetypeExample("tragedy-of-the-commons"),
  },
  {
    id: "escalation",
    label: "Escalation",
    meaning:
      "Each side's growth threatens the other, and each responds in kind — a race neither can leave without losing ground.",
    detect: escalation,
    buildExample: () => buildArchetypeExample("escalation"),
  },
  {
    id: "success-to-the-successful",
    label: "Success to the Successful",
    meaning:
      "Two activities share one allocation, and success attracts more of it — so the leader pulls ahead regardless of merit.",
    detect: successToTheSuccessful,
    buildExample: () => buildArchetypeExample("success-to-the-successful"),
  },
  {
    id: "fixes-that-fail",
    label: "Fixes that Fail",
    meaning:
      "The fix works, but its side effect feeds the problem back — so the problem returns, and more of the same fix is applied.",
    detect: fixesThatFail,
    buildExample: () => buildArchetypeExample("fixes-that-fail"),
  },
  {
    id: "shifting-the-burden",
    label: "Shifting the Burden",
    meaning:
      "A quick fix relieves the symptom while a slower, deeper solution goes unattended — and the quick fix erodes the capacity the deeper one needs.",
    detect: shiftingTheBurden,
    buildExample: () => buildArchetypeExample("shifting-the-burden"),
  },
] as const satisfies readonly ArchetypeDefinition[];

/**
 * Reports which classic archetypes the model's *structure* matches, as candidates to confirm
 * rather than a classification of what the model is.
 *
 * An archetype's structural signature is a necessary condition, not a sufficient one: any R loop
 * and B loop that happen to act on the same stock match "Limits to Growth" whether or not the
 * modeler meant them to, and a three-loop diagram will match several archetypes at once. So every
 * match reports the loops and variables that produced it, and the reader confirms or dismisses it
 * at a glance — nothing here asserts what a model *is*.
 *
 * Delay-dependent archetypes are read from the equations rather than the diagram, since a delay
 * has no shape on the canvas (see context.ts's `delaysOn`).
 *
 * Loop enumeration is bounded by `detectLoops`' own defaults, so on a densely connected model the
 * loops a match is built from are themselves a subset of all loops present. That's a ceiling on
 * what this can see, not a source of wrong answers: every match it reports is really there.
 *
 * A model with no feedback loops returns nothing, and so does one whose loops match no signature
 * — an empty result means "no structural match found", never "no archetype here".
 */
export function detectArchetypes(model: Model, options: DetectArchetypesOptions = {}): ArchetypeMatch[] {
  const { limit = 12 } = options;
  const loops = detectLoops(model);
  if (loops.length === 0) return [];

  const ctx = buildContext(model, loops);
  const matches: ArchetypeMatch[] = [];
  const seen = new Set<string>();

  for (const archetype of ARCHETYPES) {
    for (const evidence of archetype.detect(ctx)) {
      // The same structure can be reached more than once — a pair of reinforcing loops is
      // examined once as (a, b) and once as (b, a) by any detector that iterates combinations —
      // so collapse anything naming the same loops and nodes. Sorting makes that key canonical,
      // which is also what makes it usable as the match's identity.
      const id = `${archetype.id}|${[...evidence.loopIds].sort().join(",")}|${[...evidence.nodeIds].sort().join(",")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      matches.push({ id, archetype: archetype.id, label: archetype.label, ...evidence });
    }
  }

  const order = ARCHETYPES.map((a) => a.id as string);
  matches.sort(
    (a, b) =>
      order.indexOf(a.archetype) - order.indexOf(b.archetype) ||
      (a.confidence === b.confidence ? 0 : a.confidence === "likely" ? -1 : 1) ||
      a.summary.localeCompare(b.summary),
  );
  return matches.slice(0, limit);
}
