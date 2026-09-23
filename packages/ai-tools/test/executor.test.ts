import { createEmptyModel } from "@vensim-ai/core";
import { describe, expect, test } from "bun:test";
import { executeTool } from "../src/executor.js";
import { VENSIM_AI_TOOLS } from "../src/tools.js";

describe("executeTool", () => {
  test("builds a model end-to-end via tool calls", () => {
    const model = createEmptyModel("Inventory");

    const stockRes = executeTool(model, "add_stock", { name: "Inventory", initial_equation: "50" });
    expect(stockRes.ok).toBe(true);

    const inRes = executeTool(model, "add_flow", { name: "Production", equation: "10", to: "Inventory" });
    expect(inRes.ok).toBe(true);

    const outRes = executeTool(model, "add_flow", { name: "Shipping", equation: "Inventory * 0.1", from: "Inventory" });
    expect(outRes.ok).toBe(true);

    const constRes = executeTool(model, "add_constant", { name: "Target", value: 200 });
    expect(constRes.ok).toBe(true);

    const connRes = executeTool(model, "add_relation", { from: "Target", to: "Shipping", polarity: "+" });
    expect(connRes.ok).toBe(true);
    expect((connRes.result as any).polarity).toBe("+");

    const polarityRes = executeTool(model, "set_relation_polarity", { id: (connRes.result as any).id, polarity: "-" });
    expect(polarityRes.ok).toBe(true);
    expect((polarityRes.result as any).polarity).toBe("-");

    const listRes = executeTool(model, "list_model", {});
    expect(listRes.ok).toBe(true);
    expect((listRes.result as any).stocks).toHaveLength(1);

    const simRes = executeTool(model, "run_simulation", {});
    expect(simRes.ok).toBe(true);
    expect((simRes.result as any).finalValues.Inventory).toBeGreaterThan(0);

    const loopsRes = executeTool(model, "list_loops", {});
    expect(loopsRes.ok).toBe(true);
    expect(Array.isArray((loopsRes.result as any).loops)).toBe(true);

    const annotateRes = executeTool(model, "annotate_loops", {});
    expect(annotateRes.ok).toBe(true);
    expect((annotateRes.result as any).annotated).toBe((loopsRes.result as any).loops.length);
    const listAfter = executeTool(model, "list_model", {});
    expect((listAfter.result as any).comments.length).toBe((annotateRes.result as any).annotated);
  });

  test("reports errors instead of throwing", () => {
    const model = createEmptyModel();
    const res = executeTool(model, "add_flow", { name: "Orphan" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least one stock/);
  });

  test("unknown tool name", () => {
    const model = createEmptyModel();
    const res = executeTool(model, "nonexistent_tool", {});
    expect(res.ok).toBe(false);
  });

  // Compatibility check: an AI has only this tool surface (no core internals), and is expected
  // to be able to build something close to a real Vensim export from a plain-language brief.
  // This replicates example-compatibility/flow-diagram.mdl — a rabbit population with a births
  // reinforcing loop and a deaths balancing loop — using exactly the calls an AI would make,
  // and checks the result is structurally and behaviorally equivalent to the real file.
  test("can replicate the example-compatibility rabbit-population model via tool calls alone", () => {
    const model = createEmptyModel("Rabbit Population");

    expect(executeTool(model, "add_stock", { name: "Poblacion", initial_equation: "100", units: "conejos" }).ok).toBe(true);
    expect(executeTool(model, "add_constant", { name: "tasa nacimientos", value: 0.15, units: "1/Year" }).ok).toBe(true);
    expect(executeTool(model, "add_constant", { name: "tasa mortalidad", value: 0.16, units: "1/Year" }).ok).toBe(true);
    expect(
      executeTool(model, "add_flow", { name: "nacimientos", equation: "Poblacion * tasa nacimientos", to: "Poblacion", units: "conejos/Year" }).ok,
    ).toBe(true);
    expect(
      executeTool(model, "add_flow", { name: "muertes", equation: "tasa mortalidad * Poblacion", from: "Poblacion", units: "conejos/Year" }).ok,
    ).toBe(true);
    expect(executeTool(model, "add_relation", { from: "Poblacion", to: "nacimientos", polarity: "+" }).ok).toBe(true);
    expect(executeTool(model, "add_relation", { from: "tasa nacimientos", to: "nacimientos", polarity: "+" }).ok).toBe(true);
    expect(executeTool(model, "add_relation", { from: "Poblacion", to: "muertes", polarity: "+" }).ok).toBe(true);
    expect(executeTool(model, "add_relation", { from: "tasa mortalidad", to: "muertes", polarity: "+" }).ok).toBe(true);
    expect(executeTool(model, "set_sim_spec", { start_time: 0, stop_time: 200, dt: 1 }).ok).toBe(true);
    expect(executeTool(model, "auto_layout", {}).ok).toBe(true);

    const loopsRes = executeTool(model, "list_loops", {});
    expect(loopsRes.ok).toBe(true);
    const polarities = (loopsRes.result as { loops: { polarity: string }[] }).loops.map((l) => l.polarity).sort();
    expect(polarities).toEqual(["B", "R"]); // births reinforces, deaths balances — same as the reference file

    const simRes = executeTool(model, "run_simulation", {});
    expect(simRes.ok).toBe(true);
    // The reference file's own dynamics settle Poblacion near ~13.4 by t=200 (births/deaths
    // rates favor decline from the initial 100) — this is the same system, not just the same shape.
    expect((simRes.result as { finalValues: Record<string, number> }).finalValues.Poblacion).toBeCloseTo(13.4, 0);
  });
});

describe("set_lookup tool", () => {
  test("creates a lookup and drives a flow through it", () => {
    const model = createEmptyModel("Lookups");
    expect(executeTool(model, "set_sim_spec", { start_time: 0, stop_time: 3, dt: 1 }).ok).toBe(true);
    expect(executeTool(model, "add_stock", { name: "Stock", initial_equation: "100" }).ok).toBe(true);
    expect(executeTool(model, "add_flow", { name: "Drain", equation: "Effect(Stock) * Stock", from: "Stock" }).ok).toBe(true);

    const res = executeTool(model, "set_lookup", {
      name: "Effect",
      points: [
        [0, 0],
        [100, 1],
      ],
      x_min: 0,
      x_max: 100,
      y_min: 0,
      y_max: 1,
      units: "Dmnl",
    });
    expect(res.ok).toBe(true);

    const sim = executeTool(model, "run_simulation", {});
    expect(sim.ok).toBe(true);
    // t=0: Stock 100 -> Effect(100)=1 -> drain 100; t=1: Stock 0 -> 0.
    const series = (sim.result as { series: Record<string, number[]> }).series;
    expect(series.Stock![0]).toBe(100);
    expect(series.Stock![1]).toBe(0);
  });

  test("re-specifying an existing lookup replaces its curve without duplicating it", () => {
    const model = createEmptyModel();
    executeTool(model, "set_lookup", { name: "Effect", points: [[0, 0], [10, 1]] });
    executeTool(model, "set_lookup", { name: "Effect", points: [[0, 0], [10, 5]], y_max: 9 });

    const auxes = model.auxiliaries.filter((a) => a.name === "Effect");
    expect(auxes.length).toBe(1);
    const listed = executeTool(model, "list_model", {});
    const aux = (listed.result as { auxiliaries: { name: string; lookup?: { points: unknown; yMax: number } }[] }).auxiliaries.find(
      (a) => a.name === "Effect",
    );
    expect(aux?.lookup?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(aux?.lookup?.yMax).toBe(9);
  });

  test("accepts {x, y} objects as well as pairs", () => {
    const model = createEmptyModel();
    const res = executeTool(model, "set_lookup", {
      name: "Effect",
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 4 },
      ],
    });
    expect(res.ok).toBe(true);
  });

  test("rejects malformed points and empty lists", () => {
    const model = createEmptyModel();
    expect(executeTool(model, "set_lookup", { name: "A", points: [[0]] }).ok).toBe(false);
    expect(executeTool(model, "set_lookup", { name: "A", points: [] }).ok).toBe(false);
    expect(executeTool(model, "set_lookup", { name: "A", points: [[0, "x"]] }).ok).toBe(false);
  });
});

describe("tool surface consistency", () => {
  // A tool declared in the schema but with no executor case fails only at runtime, as an
  // "Unknown tool" error the model then has to recover from — a declared-but-undispatchable
  // tool is always a bug, so it's worth asserting the two lists agree.
  test("every declared tool is dispatchable", () => {
    const model = createEmptyModel();
    for (const tool of VENSIM_AI_TOOLS) {
      const res = executeTool(model, tool.name, {});
      expect(`${tool.name}: ${res.error ?? ""}`).not.toContain(`Unknown tool "${tool.name}"`);
    }
  });
});
