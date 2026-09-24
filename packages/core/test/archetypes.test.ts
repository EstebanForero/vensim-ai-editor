import { describe, expect, test } from "bun:test";
import { ARCHETYPES, buildArchetypeExample, detectArchetypes } from "../src/archetypes/index.js";
import type { ArchetypeId } from "../src/archetypes/types.js";
import { addAuxiliary, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { detectLoops } from "../src/loops/detect.js";
import { simulate } from "../src/sim/engine.js";
import { createEmptyModel } from "../src/model/types.js";

/** Everything an archetype match reports about *why* it matched — the labels and names — with
 * the free-text summary left out, so these assertions stay about structure. */
function shape(matches: ReturnType<typeof detectArchetypes>) {
  return matches.map((m) => ({ archetype: m.archetype, confidence: m.confidence, loops: m.loopLabels, nodes: m.nodeNames }));
}

function matchesOf(matches: ReturnType<typeof detectArchetypes>, archetype: ArchetypeId) {
  return matches.filter((m) => m.archetype === archetype);
}

describe("detectArchetypes", () => {
  test("Limits to Growth: a reinforcing and a balancing loop on one stock", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Population", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: "Population", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Deaths", equation: "Population * 0.01", from: "Population", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Population", to: "Births" }); // "+"
    addConnector(model, { from: "Population", to: "Deaths" }); // "+"

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      { archetype: "limits-to-growth", confidence: "likely", loops: ["R1", "B1"], nodes: ["Population"] },
    ]);
    expect(matches[0]!.summary).toBe("R1 (reinforcing) and B1 (balancing) both act on the stock `Population`.");
  });

  // The loops share the stock *and* an intermediate variable, which is just as often one loop's
  // return path as a real constraint — reported, but not at the same confidence.
  test("Limits to Growth: downgraded when the loops share more than the stock", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Store", initialEquation: "10", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "Shared", equation: "Store", pos: { x: 50, y: 0 } });
    addFlow(model, { name: "In", equation: "Shared", to: "Store", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Out", equation: "Shared", from: "Store", pos: { x: 100, y: 50 } });
    addConnector(model, { from: "Store", to: "Shared" });
    addConnector(model, { from: "Shared", to: "In" });
    addConnector(model, { from: "Shared", to: "Out" });

    const [match] = matchesOf(detectArchetypes(model), "limits-to-growth");
    expect(match!.confidence).toBe("possible");
    expect(match!.nodeNames).toEqual(["Store"]);
  });

  test("Tragedy of the Commons: one stock drawn down by two flows in different loops", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Use A", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Use B", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Water", to: "Use A" });
    addConnector(model, { from: "Water", to: "Use B" });

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      {
        archetype: "tragedy-of-the-commons",
        confidence: "likely",
        loops: ["B1", "B2"],
        nodes: ["Water", "Use A", "Use B"],
      },
    ]);
    expect(matches[0]!.summary).toContain("`Water` is drawn down by 2 separate flows");
  });

  // A single loop that happens to drain one stock through two pipes is one actor emptying two
  // pipes, not competing users — the commons signature is *independent* drawdown paths.
  test("Tragedy of the Commons: not reported when one loop carries both outflows", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "P1", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "P2", equation: "Water * 0.1", from: "Water", pos: { x: 200, y: 0 } });
    addConnector(model, { from: "Water", to: "P1" });
    addConnector(model, { from: "P1", to: "P2" });

    // Confirm the premise: P1 has a loop of its own, P2 only ever appears alongside P1.
    const loops = detectLoops(model);
    expect(loops).toHaveLength(2);
    const [p1, p2] = model.flows;
    expect(loops.filter((l) => l.nodeIds.includes(p1!.id) && !l.nodeIds.includes(p2!.id))).toHaveLength(1);
    expect(loops.filter((l) => l.nodeIds.includes(p2!.id) && !l.nodeIds.includes(p1!.id))).toHaveLength(0);

    expect(matchesOf(detectArchetypes(model), "tragedy-of-the-commons")).toEqual([]);
  });

  test("Escalation: two reinforcing loops that each push the other down", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "My Activity", equation: "My Result * 0.1", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "My Result", equation: "My Activity", pos: { x: 100, y: 0 } });
    addAuxiliary(model, { name: "Their Activity", equation: "Their Result * 0.1", pos: { x: 0, y: 100 } });
    addAuxiliary(model, { name: "Their Result", equation: "Their Activity", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "My Activity", to: "My Result" });
    addConnector(model, { from: "My Result", to: "My Activity" });
    addConnector(model, { from: "Their Activity", to: "Their Result" });
    addConnector(model, { from: "Their Result", to: "Their Activity" });
    addConnector(model, { from: "My Activity", to: "Their Result", polarity: "-" });
    addConnector(model, { from: "Their Activity", to: "My Result", polarity: "-" });

    const matches = matchesOf(detectArchetypes(model), "escalation");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBe("likely");
    // The two 2-node loops the escalation runs between — not the 4-node cycle they also form.
    for (const label of matches[0]!.loopLabels) expect(detectLoops(model).map((l) => `${l.polarity}${l.number}`)).toContain(label);
    expect(matches[0]!.nodeNames.sort()).toEqual(["My Activity", "My Result", "Their Activity", "Their Result"]);
    expect(matches[0]!.summary).toContain("`My Activity` → `Their Result`");
    expect(matches[0]!.summary).toContain("`Their Activity` → `My Result`");
  });

  test("Success to the Successful: two reinforcing loops fed by one allocation", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Allocation", equation: "Success A + Success B", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "Activity A", equation: "Allocation", pos: { x: 100, y: 0 } });
    addAuxiliary(model, { name: "Success A", equation: "Activity A", pos: { x: 200, y: 0 } });
    addAuxiliary(model, { name: "Activity B", equation: "Allocation", pos: { x: 100, y: 100 } });
    addAuxiliary(model, { name: "Success B", equation: "Activity B", pos: { x: 200, y: 100 } });
    addConnector(model, { from: "Allocation", to: "Activity A" });
    addConnector(model, { from: "Activity A", to: "Success A" });
    addConnector(model, { from: "Success A", to: "Allocation" });
    addConnector(model, { from: "Allocation", to: "Activity B" });
    addConnector(model, { from: "Activity B", to: "Success B" });
    addConnector(model, { from: "Success B", to: "Allocation" });

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      {
        archetype: "success-to-the-successful",
        confidence: "likely",
        loops: ["R1", "R2"],
        nodes: ["Allocation", "Activity A", "Success A", "Activity B", "Success B"],
      },
    ]);
    expect(matches[0]!.summary).toContain("both draw on `Allocation`");
  });

  // The minimal shape: problem and fix wired straight to each other, with the unintended
  // consequence riding on a third variable. The balancing loop has nothing of its own here, so
  // requiring a detour on both sides would miss exactly the case this archetype is drawn as.
  test("Fixes that Fail: a balancing and a reinforcing path between the same two variables", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Problem", equation: "Side Effect", pos: { x: 0, y: 0 } });
    addAuxiliary(model, { name: "Fix", equation: "Problem", pos: { x: 100, y: 0 } });
    addAuxiliary(model, { name: "Side Effect", equation: "Fix", pos: { x: 200, y: 0 } });
    addConnector(model, { from: "Problem", to: "Fix" });
    addConnector(model, { from: "Fix", to: "Problem", polarity: "-" });
    addConnector(model, { from: "Fix", to: "Side Effect" });
    addConnector(model, { from: "Side Effect", to: "Problem" });

    const matches = detectArchetypes(model);
    expect(shape(matches)).toEqual([
      { archetype: "fixes-that-fail", confidence: "likely", loops: ["B1", "R1"], nodes: ["Problem", "Fix"] },
    ]);
    // The bare balancing loop reads as a loop label, not "B1 via " with an empty detour.
    expect(matches[0]!.summary).toBe(
      "B1 (balancing) and R1 (reinforcing) are two different paths between `Problem`, `Fix` — B1, R1 via `Side Effect`.",
    );
  });

  test("no loops, no matches", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Alone", initialEquation: "1", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Tap", equation: "1", from: "Alone", pos: { x: 100, y: 0 } });
    expect(detectArchetypes(model)).toEqual([]);
  });

  test("an empty model reports nothing rather than throwing", () => {
    expect(detectArchetypes(createEmptyModel())).toEqual([]);
  });

  test("every summary names real variables, never a placeholder", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Use A", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Use B", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Water", to: "Use A" });
    addConnector(model, { from: "Water", to: "Use B" });

    for (const match of detectArchetypes(model)) {
      expect(match.summary).toContain(`\`${match.nodeNames[0]}\``);
      expect(match.nodeIds).toHaveLength(match.nodeNames.length);
      expect(match.loopIds).toHaveLength(match.loopLabels.length);
    }
  });

  test("the same structure is reported once, not once per route to it", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Water", initialEquation: "1000", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Use A", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 0 } });
    addFlow(model, { name: "Use B", equation: "Water * 0.1", from: "Water", pos: { x: 100, y: 100 } });
    addConnector(model, { from: "Water", to: "Use A" });
    addConnector(model, { from: "Water", to: "Use B" });

    const ids = detectArchetypes(model).map((m) => m.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // One candidate per shared resource, not one per pair of flows: three users of one stock are a
  // single commons, so a second one has to come from a second stock.
  // Shifting the Burden turns on a delay, which no amount of loop structure can show: the two
  // paths differ only in that one of them is slow. That is readable from the equation and from
  // nothing else, which is why this archetype was missing until DELAY existed.
  test("Shifting the Burden: a fast path and a delayed one out of the same problem", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Problem", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Relief", equation: "Problem * 0.3", from: "Problem", pos: { x: 0, y: 100 } }); // fast
    addAuxiliary(model, { name: "Slow Path", equation: "DELAY1(Problem, 8)", pos: { x: 200, y: 0 } });
    addFlow(model, { name: "Cure", equation: "Slow Path", from: "Problem", pos: { x: 200, y: 100 } }); // delayed
    addConnector(model, { from: "Problem", to: "Relief" });
    addConnector(model, { from: "Problem", to: "Slow Path" });
    addConnector(model, { from: "Slow Path", to: "Cure" });

    const matches = matchesOf(detectArchetypes(model), "shifting-the-burden");
    expect(matches).toHaveLength(1);
    // No reinforcing loop spans the two paths here, so this is the bare two-path structure.
    expect(matches[0]!.confidence).toBe("possible");
    expect(matches[0]!.summary).toContain("runs through a delay");
  });

  test("Shifting the Burden: not reported when both paths are the same speed", () => {
    const model = createEmptyModel();
    addStock(model, { name: "Problem", initialEquation: "100", pos: { x: 0, y: 0 } });
    addFlow(model, { name: "Relief", equation: "Problem * 0.3", from: "Problem", pos: { x: 0, y: 100 } });
    addFlow(model, { name: "Cure", equation: "Problem * 0.2", from: "Problem", pos: { x: 200, y: 100 } });
    addConnector(model, { from: "Problem", to: "Relief" });
    addConnector(model, { from: "Problem", to: "Cure" });
    expect(matchesOf(detectArchetypes(model), "shifting-the-burden")).toEqual([]);
  });

  test("limit caps the report", () => {
    const model = createEmptyModel();
    for (const [stock, a, b] of [
      ["Water", "Irrigate", "Drink"],
      ["Fish", "Trawl", "Angle"],
    ] as const) {
      addStock(model, { name: stock, initialEquation: "1000", pos: { x: 0, y: 0 } });
      addFlow(model, { name: a, equation: `${stock} * 0.1`, from: stock, pos: { x: 100, y: 0 } });
      addFlow(model, { name: b, equation: `${stock} * 0.1`, from: stock, pos: { x: 100, y: 100 } });
      addConnector(model, { from: stock, to: a });
      addConnector(model, { from: stock, to: b });
    }

    expect(detectArchetypes(model)).toHaveLength(2);
    expect(detectArchetypes(model, { limit: 1 })).toHaveLength(1);
  });
});

describe("archetype examples", () => {
  // The property that makes the examples trustworthy: each one is a real model the detector
  // reads as the archetype it is filed under. Neither can drift without the suite failing.
  for (const archetype of ARCHETYPES) {
    test(`${archetype.label}: its own example is detected as it`, () => {
      expect(detectArchetypes(buildArchetypeExample(archetype.id)).map((m) => m.archetype)).toContain(archetype.id);
    });

    test(`${archetype.label}: its example runs and produces finite output`, () => {
      const result = simulate(buildArchetypeExample(archetype.id));
      expect(result.time.length).toBeGreaterThan(1);
      for (const [name, values] of Object.entries(result.series)) {
        expect(values.every((v) => Number.isFinite(v))).toBe(true);
        expect(name.length).toBeGreaterThan(0);
      }
      expect(Object.keys(result.series).length).toBeGreaterThan(1);
    });

    test(`${archetype.label}: its example has a label, a meaning and a distinct model`, () => {
      expect(archetype.label.length).toBeGreaterThan(0);
      expect(archetype.meaning.length).toBeGreaterThan(20);
      expect(buildArchetypeExample(archetype.id).name).toContain(archetype.label.split(" — ")[0]!);
    });

    test(`${archetype.label}: building its example twice gives independent models`, () => {
      const first = buildArchetypeExample(archetype.id);
      const second = buildArchetypeExample(archetype.id);
      expect(first.stocks.map((s) => s.id)).not.toEqual(second.stocks.map((s) => s.id));
    });
  }

  test("no two archetypes share an id", () => {
    const ids = ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
