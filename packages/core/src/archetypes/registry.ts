// The archetype table, and the driver that reports against it.
//
// This is the one place an archetype is declared. Adding a seventh is a detector in detectors.ts,
// an example in examples.ts, and one row here — everything downstream (report order, labels,
// the meanings shown beside each result, the example offered to open) reads from this table, and
// `ArchetypeId` is derived from it, so the UI's own per-archetype maps are compile-checked for
// exhaustiveness against it.

import { buildContext, type ArchetypeContext, type Evidence } from "./context.js";
import { checkCurve, climbs, collapses, driftsDown, eroded, givesBackGain, plateaus, rebounds, runsAway, starvedOut, type ArchetypeCurve } from "./curve.js";
import {
  erodingGoals,
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
import type { ArchetypeId, ArchetypeMatch, DetectArchetypesOptions } from "./types.js";

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
  /**
   * The shape this archetype's example has to produce when it runs, by series name. Checked by
   * `verifyArchetypeExample`, so an example that stops behaving like its archetype fails the suite
   * without anyone having to write a test for it — see curve.ts for why structure alone is not
   * enough, and for what counts as a spike rather than a failure.
   */
  curve: ArchetypeCurve;
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
    curve: { Population: plateaus },
  },
  {
    id: "tragedy-of-the-commons",
    label: "Tragedy of the Commons",
    meaning:
      "Each user's draw on a shared resource looks harmless on its own; together the loops deplete it, and no single one is the cause.",
    detect: tragedyOfTheCommons,
    buildExample: () => buildArchetypeExample("tragedy-of-the-commons"),
    curve: { "Water available": collapses },
  },
  {
    id: "escalation",
    label: "Escalation",
    meaning:
      "Each side's growth threatens the other, and each responds in kind — a race neither can leave without losing ground.",
    detect: escalation,
    buildExample: () => buildArchetypeExample("escalation"),
    curve: { "Missiles A": runsAway, "Missiles B": runsAway },
  },
  {
    id: "success-to-the-successful",
    label: "Success to the Successful",
    meaning:
      "Two activities share one allocation, and success attracts more of it — so the leader pulls ahead regardless of merit.",
    detect: successToTheSuccessful,
    buildExample: () => buildArchetypeExample("success-to-the-successful"),
    curve: { "Activity A": climbs, "Activity B": starvedOut },
  },
  {
    id: "fixes-that-fail",
    label: "Fixes that Fail",
    meaning:
      "The fix works, but its side effect feeds the problem back — so the problem returns, and more of the same fix is applied.",
    detect: fixesThatFail,
    buildExample: () => buildArchetypeExample("fixes-that-fail"),
    curve: { Problem: rebounds },
  },
  {
    id: "shifting-the-burden",
    label: "Shifting the Burden",
    meaning:
      "A quick fix relieves the symptom while a slower, deeper solution goes unattended — and the quick fix erodes the capacity the deeper one needs.",
    detect: shiftingTheBurden,
    buildExample: () => buildArchetypeExample("shifting-the-burden"),
    curve: { Problem: givesBackGain, Capacity: eroded },
  },
  {
    id: "eroding-goals",
    label: "Eroding Goals",
    meaning:
      "A target is itself a level, so the gap between it and performance can be closed from either end — and the cheaper end is writing the target down. Nothing fails, and the standard ends up where the results already were.",
    detect: erodingGoals,
    buildExample: () => buildArchetypeExample("eroding-goals"),
    curve: { "Quality standard": driftsDown, Performance: plateaus },
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
/**
 * Runs this archetype's example and reports every way its run fails to look like the archetype.
 * Empty means it looks right. This is the automatic half of "the example really is the archetype":
 * the detector reads its structure, this reads its behaviour.
 */
export function verifyArchetypeExample(id: ArchetypeId): string[] {
  const archetype = ARCHETYPES.find((a) => a.id === id);
  if (!archetype) return [`no archetype "${id}"`];
  return checkCurve(archetype.buildExample(), archetype.curve);
}

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

  // Spend the limit round-robin across the archetypes that matched, rather than taking the first
  // `limit` in archetype order. Limits to Growth fires on every (R, B) pair acting on one stock,
  // so a model with a handful of loops yields a dozen of them — and a plain slice then spends the
  // entire report on that one archetype and silently drops every other match behind it. A model
  // that matches only one archetype is unaffected: it still gets the whole limit.
  const groups = order.map((id) => matches.filter((m) => m.archetype === id));
  const report: ArchetypeMatch[] = [];
  for (let round = 0; report.length < limit; round++) {
    const before = report.length;
    for (const group of groups) {
      const next = group[round];
      if (next && report.length < limit) report.push(next);
    }
    if (report.length === before) break; // every group is exhausted
  }
  return report;
}
