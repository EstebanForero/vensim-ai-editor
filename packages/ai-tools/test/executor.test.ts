import { createEmptyModel } from "@vensim-ai/core";
import { describe, expect, test } from "bun:test";
import { executeTool } from "../src/executor.js";

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
