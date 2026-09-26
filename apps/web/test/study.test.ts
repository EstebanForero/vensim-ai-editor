import { describe, expect, test } from "bun:test";
import { NEUTRAL_TOOLS } from "@vensim-ai/agent";
import { EDITING_TOOLS, MUTATING_TOOL_NAMES, MODES, READ_ONLY_TOOLS, findMode, systemPromptFor } from "../src/study/modes.js";

/**
 * The mode table is the study tab's whole design, so it is the thing worth pinning: what a mode
 * is allowed to do, and that a tool nobody has classified can't quietly become allowed.
 */

describe("the tool split", () => {
  // The guarantee a "judge this model" mode rests on is that it is not *offered* the tools that
  // would let it rewrite the model — so this is the test that keeps that true as tools are added.
  test("every tool the agent has is classified, and the two sets don't overlap", () => {
    const readOnly = new Set(READ_ONLY_TOOLS.map((t) => t.name));
    const unclassified = NEUTRAL_TOOLS.filter((t) => !readOnly.has(t.name) && !MUTATING_TOOL_NAMES.has(t.name));
    expect(unclassified.map((t) => t.name)).toEqual([]);

    const both = READ_ONLY_TOOLS.filter((t) => MUTATING_TOOL_NAMES.has(t.name));
    expect(both.map((t) => t.name)).toEqual([]);
  });

  test("a name in the mutating set that no tool has is a stale entry", () => {
    const names = new Set(NEUTRAL_TOOLS.map((t) => t.name));
    const stale = [...MUTATING_TOOL_NAMES].filter((n) => !names.has(n));
    expect(stale).toEqual([]);
  });

  test("the read-only set is the useful half of what the agent can do", () => {
    // Not just "some tools" — a mode that can't look at the model, run it, or measure it would be
    // handed an empty toolbox and would answer from imagination.
    expect(READ_ONLY_TOOLS.map((t) => t.name).sort()).toEqual(["check_units", "list_loops", "list_model", "run_python", "run_simulation"]);
    expect(EDITING_TOOLS.length).toBe(NEUTRAL_TOOLS.length);
  });
});

describe("the modes", () => {
  test("ids are unique and non-empty", () => {
    const ids = MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  // The two ways a mode can describe itself: `writes` is what the panel tells the user, and
  // `tools` is what actually decides. They must not disagree, or the panel lies about what
  // pressing send will do.
  test("`writes` agrees with the tools the mode is given", () => {
    for (const mode of MODES) {
      const mutating = mode.tools.some((t) => MUTATING_TOOL_NAMES.has(t.name));
      expect({ id: mode.id, writes: mode.writes }).toEqual({ id: mode.id, writes: mutating });
    }
  });

  test("a mode that reads a model never gets the tools that would change it", () => {
    for (const mode of MODES.filter((m) => !m.writes)) {
      expect(mode.tools.map((t) => t.name).sort()).toEqual(READ_ONLY_TOOLS.map((t) => t.name).sort());
    }
  });

  test("every mode says what it does, how to start, and what it is for", () => {
    for (const mode of MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.blurb.length).toBeGreaterThan(20);
      expect(mode.starters.length).toBeGreaterThan(0);
      expect(mode.system.length).toBeGreaterThan(100);
    }
  });

  test("a mode that expects a situation to be described has somewhere to describe it", () => {
    for (const mode of MODES.filter((m) => m.input === "context" || m.input === "context+model")) {
      expect(mode.placeholder).toBeTruthy();
    }
  });

  test("the modes asked for are all here", () => {
    const ids = new Set(MODES.map((m) => m.id));
    for (const wanted of ["make-an-exercise", "find-errors", "equations-from-context", "build-from-context", "is-it-right", "name-the-archetype", "find-the-loops"]) {
      expect(ids.has(wanted)).toBe(true);
    }
  });
});

describe("the prompt a mode runs under", () => {
  test("it carries the shared preamble and the mode's own instructions", () => {
    const mode = findMode("find-errors");
    const prompt = systemPromptFor(mode);
    expect(prompt).toContain("system dynamics");
    expect(prompt).toContain(mode.system);
    expect(prompt.indexOf("system dynamics")).toBeLessThan(prompt.indexOf(mode.system));
  });

  // A judging mode that edits the model is the failure this whole split exists to prevent, and
  // the prompt is where it would be most tempting: "fix it" is a natural thing to write, and the
  // tool list is what makes it impossible rather than merely discouraged.
  test("a mode that cannot edit is told so, rather than only being denied the tools", () => {
    for (const mode of MODES.filter((m) => !m.writes)) {
      // Generated from `writes` rather than written into each mode, so it cannot be forgotten.
      expect(systemPromptFor(mode)).toMatch(/no tools that change the model/i);
    }
  });

  test("an unknown id falls back to the first mode rather than throwing", () => {
    expect(findMode("no-such-mode").id).toBe(MODES[0]!.id);
  });
});
