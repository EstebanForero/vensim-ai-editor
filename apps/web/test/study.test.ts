import { describe, expect, test } from "bun:test";
import { NEUTRAL_TOOLS } from "@vensim-ai/agent";
import { EDITING_TOOLS, MUTATING_TOOL_NAMES, MODES, READ_ONLY_TOOLS, findMode, planTurn, type StudyMode } from "../src/study/modes.js";

/**
 * The mode table is the study tab's whole design, so it is the thing worth pinning: what a turn is
 * allowed to do, and whether what the panel says about it is true.
 */

const withModel = (mode: StudyMode) => planTurn(mode, { hasModel: true });
const emptyCanvas = (mode: StudyMode) => planTurn(mode, { hasModel: false });

/** Modes whose subject is the model on the canvas — the ones with a hole in them when it is empty. */
const modelSubject = () => MODES.filter((m) => m.input === "model" || m.input === "context+model");

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
    expect([...MUTATING_TOOL_NAMES].filter((n) => !names.has(n))).toEqual([]);
  });

  test("the read-only set is the useful half of what the agent can do", () => {
    // Not just "some tools" — a turn that can't look at the model, run it, or measure it would be
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

  test("a mode that reads a model is never given the tools that would change it", () => {
    for (const mode of MODES.filter((m) => m.input === "model").concat(MODES.filter((m) => m.input === "context+model"))) {
      if (emptyCanvas(mode).writes) continue; // the empty-canvas setup, asserted separately below
      expect({ id: mode.id, tools: withModel(mode).tools.map((t) => t.name).sort() }).toEqual({
        id: mode.id,
        tools: READ_ONLY_TOOLS.map((t) => t.name).sort(),
      });
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

describe("planning a turn", () => {
  // The bug this exists for: "Find the mistakes" on an empty canvas told the agent to look through
  // a model that wasn't there, and the agent dutifully went looking. A mode whose subject is the
  // model has to say what to do when there isn't one.
  test("a mode whose subject is the model has somewhere to go when there isn't one", () => {
    for (const mode of modelSubject()) {
      const plan = emptyCanvas(mode);
      expect({ id: mode.id, note: typeof plan.note }).toEqual({ id: mode.id, note: "string" });
      expect({ id: mode.id, starters: plan.starters }).toEqual({ id: mode.id, starters: [mode.whenEmpty!.starter] });
      expect(plan.system).toContain(mode.whenEmpty!.system);
      // And the mode's own instructions are *not* in it: "find what is wrong with the model on the
      // canvas" is exactly the instruction that made the agent look for one.
      expect(plan.system).not.toContain(mode.system);
    }
  });

  test("a mode that doesn't need a model runs as itself either way", () => {
    for (const mode of MODES.filter((m) => m.input === "context")) {
      const empty = emptyCanvas(mode);
      // Only the preamble differs — it says there is no model, which is true and worth saying to
      // any turn. The mode's own brief, tools and starters are the mode's own in both states.
      expect({ id: mode.id, note: empty.note, tools: empty.tools, starters: empty.starters }).toEqual({
        id: mode.id,
        note: null,
        tools: withModel(mode).tools,
        starters: mode.starters,
      });
      expect(empty.system).toContain(mode.system);
    }
  });

  test("examining a model never writes to it, and setting one up may build it", () => {
    const inspecting = withModel(findMode("find-errors"));
    expect(inspecting.writes).toBe(false);
    // The one case a reading mode may write: there is no model, so there is nothing to protect,
    // and a turn that could only report "there is nothing here" wastes the click.
    const setting = emptyCanvas(findMode("find-errors"));
    expect(setting.writes).toBe(true);
  });

  // What the badge says has to be what the turn does, in both states — the panel reads `writes`
  // off the plan rather than off the mode, so there is one answer rather than two.
  test("the plan's `writes` is read off the tools, so it cannot drift from them", () => {
    for (const mode of MODES) {
      for (const plan of [withModel(mode), emptyCanvas(mode)]) {
        const mutating = plan.tools.some((t) => MUTATING_TOOL_NAMES.has(t.name));
        expect({ id: mode.id, writes: plan.writes }).toEqual({ id: mode.id, writes: mutating });
      }
    }
  });

  test("the prompt tells the truth about what is on the canvas", () => {
    const full = withModel(findMode("find-errors")).system;
    const empty = emptyCanvas(findMode("find-errors")).system;
    expect(full).toContain("The model on the canvas is a real model");
    expect(full).not.toContain("canvas is empty");
    expect(empty).toContain("canvas is empty");
    expect(empty).not.toContain("The model on the canvas is a real model");
  });

  // The prompt is where "fix it" would be most tempting to write, and the tool list is what makes
  // it impossible rather than merely discouraged — so a turn that cannot edit is told, every time.
  test("a turn that cannot edit is told so, rather than only being denied the tools", () => {
    for (const mode of MODES) {
      const plan = withModel(mode);
      if (plan.writes) continue;
      expect({ id: mode.id, told: /no tools that change the model/i.test(plan.system) }).toEqual({ id: mode.id, told: true });
    }
  });

  test("an unknown id falls back to the first mode rather than throwing", () => {
    expect(findMode("no-such-mode").id).toBe(MODES[0]!.id);
  });
});
