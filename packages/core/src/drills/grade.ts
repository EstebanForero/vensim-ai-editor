// Whether an answer is right.
//
// Deliberately a pure function of the question and the response, with nothing else consulted: the
// answer is on the question, so marking cannot depend on the model having been edited in the
// meantime, and it cannot fail midway. The whole point of a drill over asking the agent is that the
// mark is not a judgement — it is a comparison.

import type { DrillQuestion, Verdict } from "./types.js";

/**
 * How an answer is compared.
 *
 * This is a real decision rather than a convenience, and both directions are failures worth caring
 * about: too strict and `R1` is wrong because it was typed `r1`, too loose and a wrong answer is
 * marked right. It folds the four differences that are genuinely the same answer written twice —
 * surrounding space, case, runs of whitespace, and one trailing full stop — and strips quotes only
 * when they *match*, so `"Interest Earned"` written the way the equation language requires it is
 * still the name `Interest Earned`.
 *
 * Nothing else. No punctuation-stripping, no word-order folding, no "did you mean".
 */
export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim()
    .toLowerCase();
}

/** The parts of a set-shaped answer — a loop's members, a variable's dependencies. Split on the
 * separators people actually type: a comma, a semicolon, or a newline. */
function answerSet(s: string): Set<string> {
  return new Set(
    s
      .split(/[,;\n]/)
      .map(normalizeAnswer)
      .filter(Boolean),
  );
}

export function gradeAnswer(question: DrillQuestion, response: string): Verdict {
  const given = response.trim();
  const expected = question.answer;

  if (question.kind === "numeric") {
    // `Number("")` is 0, which would make an empty answer look like a confident guess at zero — so
    // the empty case is rejected before the parse rather than by it.
    const got = given === "" ? NaN : Number(normalizeAnswer(given));
    const want = Number(normalizeAnswer(expected));
    const tolerance = question.tolerance ?? 0;
    const correct = Number.isFinite(got) && Number.isFinite(want) && Math.abs(got - want) <= tolerance;
    return { correct, expected, given };
  }

  if (question.unordered) {
    const want = answerSet(expected);
    const got = answerSet(given);
    const correct = want.size > 0 && got.size === want.size && [...want].every((w) => got.has(w));
    return { correct, expected, given };
  }

  const accepted = new Set([normalizeAnswer(expected), ...(question.accept ?? []).map(normalizeAnswer)]);
  return { correct: accepted.has(normalizeAnswer(given)), expected, given };
}
