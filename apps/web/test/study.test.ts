import { describe, expect, test } from "bun:test";
import { NEUTRAL_TOOLS, isMutatingTool } from "@vensim-ai/agent";
import { buildArchetypeExample, createEmptyModel, generateQuestions, type DrillSkill } from "@vensim-ai/core";
import { EDITING_TOOLS, MUTATING_TOOL_NAMES, MODES, READ_ONLY_TOOLS, findMode, planTurn, type StudyMode } from "../src/study/modes.js";
import { DEFAULT_DRILL, DRILLS, findDrill } from "../src/study/drill/modes.js";

/**
 * The mode table is the study tab's whole design, so it is the thing worth pinning: what a turn is
 * allowed to do, and whether what the panel says about it is true.
 */

const withModel = (mode: StudyMode) => planTurn(mode, { hasModel: true });
const emptyCanvas = (mode: StudyMode) => planTurn(mode, { hasModel: false });

/**
 * The modes whose own turn cannot be run against an empty canvas, by id.
 *
 * Pinned rather than derived from `input`, because the boundary is a judgement about each mode
 * rather than a property of where its subject comes from: "Write the equations" takes its subject
 * from a pasted description, which is never missing, but has nowhere to put the equations until
 * the variables exist. Pinned so that a new mode has to make that call explicitly instead of
 * landing on one side of it by accident.
 */
const NEEDS_A_CANVAS = ["equations-from-context", "find-errors", "find-the-loops", "is-it-right", "name-the-archetype"];

/** The modes with a hole in them when the canvas is empty — see NEEDS_A_CANVAS. */
const needsCanvas = () => MODES.filter((m) => m.whenEmpty);

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

  // The canvas is re-drawn by committing the model, which replaces every node and makes React
  // Flow re-measure all of them. Doing that for a tool that only *read* the model is a full
  // rebuild for nothing — and if the call blocked the main thread while it ran, the re-measure
  // never arrives and the canvas is left blank. `run_python` compiling WebAssembly is exactly
  // that, and "everything disappeared when run_python was used" was the chat panel rebuilding
  // the diagram because the model had been read.
  test("nothing that only reads the model is classified as changing it", () => {
    for (const name of ["list_model", "list_loops", "run_simulation", "run_python", "check_units"]) {
      expect({ name, mutates: isMutatingTool(name) }).toEqual({ name, mutates: false });
    }
    for (const name of ["add_stock", "set_equation", "auto_layout", "annotate_loops"]) {
      expect({ name, mutates: isMutatingTool(name) }).toEqual({ name, mutates: true });
    }
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
  // a model that wasn't there, and the agent dutifully went looking. A mode whose own turn has
  // nothing to work on has to say what to do instead.
  test("the modes that cannot run on an empty canvas are exactly the ones that say so", () => {
    expect(needsCanvas().map((m) => m.id).sort()).toEqual([...NEEDS_A_CANVAS].sort());
  });

  test("every one of them has somewhere to go, and it is not the mode's own job", () => {
    for (const mode of needsCanvas()) {
      const plan = emptyCanvas(mode);
      const setup = mode.whenEmpty!;
      expect({ id: mode.id, note: typeof plan.note }).toEqual({ id: mode.id, note: "string" });
      expect({ id: mode.id, starters: plan.starters }).toEqual({ id: mode.id, starters: [setup.starter] });
      expect(plan.system).toContain(setup.system);
      // And the mode's own instructions are *not* in it: "find what is wrong with the model on the
      // canvas" is exactly the instruction that made the agent look for one.
      expect(plan.system).not.toContain(mode.system);
    }
  });

  // The same guarantee from the other direction, and the one that does not rest on the pinned
  // list: whatever `input` says, a mode whose subject is the model on the canvas always has the
  // hole, so it can never arrive without something to fill it.
  test("a mode whose subject is the model always has somewhere to go without one", () => {
    for (const mode of MODES.filter((m) => m.input === "model" || m.input === "context+model")) {
      expect({ id: mode.id, hasWhenEmpty: Boolean(mode.whenEmpty) }).toEqual({ id: mode.id, hasWhenEmpty: true });
    }
  });

  test("a mode that can start from nothing runs as itself either way", () => {
    for (const mode of MODES.filter((m) => !m.whenEmpty)) {
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

describe("the drills", () => {
  test("ids are unique, and none collides with a mode's", () => {
    const ids = DRILLS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => MODES.some((m) => m.id === id))).toEqual([]);
  });

  test("every drill says what it drills, how much of it, and what to do with nothing to practise on", () => {
    for (const drill of DRILLS) {
      expect({ id: drill.id, label: drill.label.length > 0, blurb: drill.blurb.length > 20, count: drill.count > 0, hint: drill.hint.length > 20 }).toEqual({
        id: drill.id,
        label: true,
        blurb: true,
        count: true,
        hint: true,
      });
      expect(drill.skills.length).toBeGreaterThan(0);
    }
  });

  test("an unknown drill id falls back to the first rather than throwing", () => {
    expect(findDrill("no-such-drill").id).toBe(DEFAULT_DRILL.id);
    expect(DRILLS).toContain(DEFAULT_DRILL);
  });

  // `needsModel` is what decides between "nothing here yet" and "let me build you something to
  // practise on", and getting it wrong is how the tab ends up telling someone to go and draw the
  // diagram they were trying to learn. The only way to check it is to ask the generator.
  test("a drill that says it needs a model produces nothing without one — and one that doesn't still does", () => {
    const empty = createEmptyModel("Empty");
    for (const drill of DRILLS) {
      const questions = generateQuestions(empty, { skills: drill.skills, seed: 0 });
      expect({ id: drill.id, asked: questions.length > 0 }).toEqual({ id: drill.id, asked: !drill.needsModel });
    }
  });

  test("only a drill that asks about archetypes offers to have the agent write one", () => {
    for (const drill of DRILLS) {
      expect({ id: drill.id, canAsk: drill.canAskForSituation }).toEqual({
        id: drill.id,
        canAsk: drill.skills.includes("archetypes"),
      });
    }
  });

  test("every drill can fill a sitting of the size it advertises", () => {
    // Only true where there is something to ask about — an empty model is checked below. This is
    // the other half: on a real model, a drill must not advertise eight questions and produce two.
    const model = buildArchetypeExample("tragedy-of-the-commons");
    for (const drill of DRILLS.filter((d) => !d.skills.includes("archetypes"))) {
      const questions = generateQuestions(model, { skills: drill.skills, count: drill.count, seed: 0 });
      expect({ id: drill.id, full: questions.length >= drill.count }).toEqual({ id: drill.id, full: true });
    }
  });

  // The complaint this was built for: with an empty canvas, "Which archetype?" had nothing to show
  // and nothing to say. A situation needs no model, so this drill is the one that works from cold.
  test("the archetype drill works on an empty canvas, because a situation needs no model", () => {
    const questions = generateQuestions(createEmptyModel("Empty"), { skills: ["archetypes"], count: 6, seed: 0 });
    expect(questions.length).toBeGreaterThanOrEqual(6);
    expect(questions.every((q) => q.situation !== undefined && q.kind === "choice")).toBe(true);
  });

  test("a model-based drill produces nothing on an empty canvas rather than an error or a guess", () => {
    const empty = createEmptyModel("Empty");
    for (const skill of ["loops", "equations"] as DrillSkill[]) {
      expect({ skill, questions: generateQuestions(empty, { skills: [skill] }) }).toEqual({ skill, questions: [] });
    }
  });
});
