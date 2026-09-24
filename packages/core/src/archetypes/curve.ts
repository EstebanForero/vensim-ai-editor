// What an example's own run has to *look* like.
//
// The structural detector answers "does this model contain the archetype's loops?". That is a
// necessary condition and a weak one — a model can carry an archetype's loops and be driven by
// something else entirely, which is exactly what several of these examples were doing while
// passing every structural test. The curve is the second half of the claim: the loops have to do
// what the archetype says they do, and the archetypes are drawn with recognisable shapes.
//
// So each archetype declares the shape its example must produce, and `verifyArchetypeExample`
// runs it. Adding an archetype means writing one line here, not one test.

import { simulate } from "../sim/engine.js";
import type { Model } from "../model/types.js";

/**
 * How much of a run counts as its settled state. The tail is read as a *median* rather than its
 * final value, and this is the whole reason this module exists rather than a few expect() calls.
 *
 * A depleted resource does not sit still at zero: whatever regrowth is left keeps nudging it up
 * and the harvest takes it straight back down, so the end of a collapse is a floor with spikes on
 * it rather than a line. Reading the last value would make what that stock *is* depend on where
 * the run happened to stop.
 */
const TAIL = 0.1;

export interface Shape {
  first: number;
  peak: number;
  /** Where the peak falls, 0..1 through the run. */
  peakAt: number;
  low: number;
  /** Where the trough falls, 0..1 through the run. */
  lowAt: number;
  /** What the run settles at — the median of its last tenth, so spikes don't count. */
  settled: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function shapeOf(values: number[]): Shape {
  const at = (v: number) => v / Math.max(1, values.length - 1);
  const peak = Math.max(...values);
  const low = Math.min(...values);
  const tail = values.slice(Math.max(1, Math.floor(values.length * (1 - TAIL))));
  return {
    first: values[0]!,
    peak,
    peakAt: at(values.indexOf(peak)),
    low,
    lowAt: at(values.indexOf(low)),
    settled: median(tail),
  };
}

/**
 * A claim about a curve. Returns a sentence saying how the run failed it, or null if it held.
 *
 * These are deliberately rough — they say "this is the shape", not "this is the number" — because
 * they are checking a teaching example, and an example whose parameter values are load-bearing for
 * a test is one that can't be tuned.
 */
export type ShapeCheck = (s: Shape) => string | null;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Climbs, and then stops: the tail is nearly level, sitting at a ceiling rather than a slope. */
export const plateaus: ShapeCheck = (s) => {
  if (s.settled < s.first * 1.5) return `never grew: ${s.first.toFixed(0)} → ${s.settled.toFixed(0)}`;
  if (s.peak > s.settled * 1.25) return `overshot to ${s.peak.toFixed(0)} before settling at ${s.settled.toFixed(0)}`;
  // A plateau is a *level* tail. Note that "the peak is at the end" says nothing here — any run
  // that is still climbing has its maximum at the end, and a genuine plateau has it there too.
  // What says something is how much of the total rise happened in the last tenth of the run.
  const tail = s.peak - s.settled;
  const rise = s.settled - s.first;
  if (tail > rise * 0.1) return `still climbing at the end — the last tenth accounts for ${pct(tail / rise)} of the rise`;
  return null;
};

/** Climbs, peaks part-way through, and comes down to nothing — the whole three-phase curve. */
export const collapses: ShapeCheck = (s) => {
  if (s.peak < s.first * 1.05) return `never rose above where it started (${pct(s.peak / s.first - 1)})`;
  if (s.peakAt < 0.15) return `peaked at ${pct(s.peakAt)} of the run — that is a fall, not a collapse`;
  if (s.peakAt > 0.7) return `peaked at ${pct(s.peakAt)} of the run, leaving no time to collapse`;
  if (s.settled > s.peak * 0.05) return `settled at ${s.settled.toFixed(0)}, which is still ${pct(s.settled / s.peak)} of the peak`;
  return null;
};

/** Keeps accelerating. Nothing in it is a plateau. */
export const runsAway: ShapeCheck = (s) => {
  if (s.settled < s.first * 3) return `only reached ${s.settled.toFixed(0)}, which is not a runaway`;
  if (s.peakAt < 0.95) return `turned over at ${pct(s.peakAt)} of the run, so something stopped it`;
  return null;
};

/** Climbs and keeps climbing — the winning side of a divergence. */
export const climbs: ShapeCheck = (s) => {
  if (s.settled < s.first * 3) return `only grew from ${s.first.toFixed(0)} to ${s.settled.toFixed(0)}`;
  if (s.lowAt > 0.05) return "dipped at the start rather than climbing";
  return null;
};

/** Rises, peaks, and is starved out to nothing — the losing side of a divergence. */
export const starvedOut: ShapeCheck = (s) => {
  if (s.peakAt <= 0.02) return "was beaten from the first step, so it never competed";
  if (s.settled > s.first * 0.1) return `still at ${s.settled.toFixed(0)} — starved down, but not out`;
  return null;
};

/** Dips below where it started, then comes back past it. */
export const rebounds: ShapeCheck = (s) => {
  if (s.low > s.first * 0.7) return `never really fell (low ${s.low.toFixed(0)} against a start of ${s.first.toFixed(0)})`;
  if (s.lowAt > 0.5) return `hit its low at ${pct(s.lowAt)} of the run, too late for a rebound to show`;
  if (s.settled < s.first * 1.25) return `ended at ${s.settled.toFixed(0)}, no worse than it started`;
  return null;
};

/** Falls hard, gives part of the gain back — but not past where it started. */
export const givesBackGain: ShapeCheck = (s) => {
  if (s.low > s.first * 0.4) return `only fell to ${s.low.toFixed(0)} of a start at ${s.first.toFixed(0)}`;
  if (s.settled < s.low * 2) return `stayed down at ${s.settled.toFixed(0)} — that is a fix that worked`;
  if (s.settled > s.first) return `ended at ${s.settled.toFixed(0)}, past where it started — that is Fixes that Fail`;
  return null;
};

/**
 * Wears away to nothing and stays there — a capacity being consumed rather than a contest being
 * lost, so unlike `starvedOut` it makes no claim about having risen first.
 *
 * The threshold is deliberately loose because this is the check that has to survive the spikes: a
 * stock pinned near zero keeps being nudged up and pushed back down, so "nothing" here means
 * "under a tenth of where it started", not "exactly zero".
 */
export const eroded: ShapeCheck = (s) => {
  if (s.peak < s.first * 0.9) return "was already falling before anything happened to it";
  if (s.settled > s.first * 0.1) return `settled at ${s.settled.toFixed(0)}, still ${pct(s.settled / s.first)} of where it started`;
  return null;
};

/** The curve each archetype's example has to produce, by series name. */
export type ArchetypeCurve = Record<string, ShapeCheck>;

/** Runs this archetype's example and reports every way its run fails to look like the archetype. */
export function checkCurve(model: Model, curve: ArchetypeCurve): string[] {
  const result = simulate(model);
  const problems: string[] = [];
  for (const [name, check] of Object.entries(curve)) {
    const values = result.series[name];
    if (!values) {
      problems.push(`"${name}" is not in the model, so its shape can't be checked`);
      continue;
    }
    const failure = check(shapeOf(values));
    if (failure) problems.push(`"${name}" ${failure}`);
  }
  return problems;
}
