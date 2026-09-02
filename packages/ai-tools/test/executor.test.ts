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
});
