import { describe, expect, test } from "bun:test";
import { ARCHETYPES, buildArchetypeExample, simulate } from "@vensim-ai/core";
import { axisFor } from "../src/lib/curveAxis.js";

/** The series each archetype's sample curve plots — the same declaration `verifyArchetypeExample`
 * checks, so this test and the chart can't disagree about what a sample curve is. */
function plottedRuns() {
  return ARCHETYPES.map((a) => {
    const run = simulate(buildArchetypeExample(a.id));
    const names = Object.keys(a.curve);
    return { id: a.id, values: names.flatMap((n) => run.series[n] ?? []) };
  });
}

describe("axisFor", () => {
  // The failure this guards is silent and total: a top below the largest value clips the curve,
  // and the whole point of the panel is that the curve's shape is visible.
  test("every archetype's sample curve fits under its own axis", () => {
    for (const { id, values } of plottedRuns()) {
      expect(values.length).toBeGreaterThan(1);
      const { top } = axisFor(Math.max(...values));
      const tooBig = values.filter((v) => v > top);
      expect({ id, tooBig }).toEqual({ id, tooBig: [] });
    }
  });

  test("ticks are round, ascending, and the top is the last of them", () => {
    for (const max of [37, 1486.8, 3948.3, 323604, 0.4, 9, 10, 99, 12345]) {
      const { top, ticks } = axisFor(max);
      expect(ticks[0]).toBe(0);
      expect(top).toBe(ticks.at(-1));
      expect(top).toBeGreaterThanOrEqual(max);
      expect(ticks).toHaveLength(5);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
      // Every tick is the same step apart, and that step is 1, 2 or 5 times a power of ten.
      const step = ticks[1]!;
      const mantissa = Number((step / 10 ** Math.floor(Math.log10(step))).toPrecision(12));
      expect([1, 2, 5]).toContain(mantissa);
      for (let i = 0; i < ticks.length; i++) expect(ticks[i]!).toBeCloseTo(i * step, 6);
    }
  });

  // A chart whose axis runs to twice its data wastes half the plot on empty space — most visible
  // on the escalation curve, which would otherwise sit in the bottom third of its own frame. 2.5x
  // is the true worst case: the 2-to-5 gap between allowed steps is the widest one there is.
  test("the axis never leaves more than 2.5x headroom, and usually much less", () => {
    for (const max of [37, 1486.8, 3948.3, 323604, 9, 10, 99, 2.5, 0.03]) {
      expect(axisFor(max).top).toBeLessThanOrEqual(max * 2.5);
    }
    // The archetypes' own runs, which is where it has to look right.
    for (const { id, values } of plottedRuns()) {
      const max = Math.max(...values);
      expect({ id, fits: axisFor(max).top / max <= 1.4 }).toEqual({ id, fits: true });
    }
  });

  test("a flat or empty run still gets a drawable axis", () => {
    expect(axisFor(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(axisFor(-5).top).toBeGreaterThan(0);
  });
});
