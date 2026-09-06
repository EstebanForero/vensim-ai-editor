import { describe, expect, test } from "bun:test";
import { addAuxiliary, addConnector, addFlow, addStock, deleteElement, renameVariable, setEquation } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";
import { validateModel } from "../src/model/validate.js";

describe("builder", () => {
  test("builds a simple population model", () => {
    const model = createEmptyModel("Population");
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    const births = addFlow(model, { name: "Births", equation: "Population*Birth Rate", to: pop.id });
    addFlow(model, { name: "Deaths", equation: "Population*Death Rate", from: pop.id });
    addAuxiliary(model, { name: "Birth Rate", equation: "0.02" });
    addAuxiliary(model, { name: "Death Rate", equation: "0.01" });
    addConnector(model, { from: "Birth Rate", to: births.id });

    expect(model.stocks[0]!.inflows).toEqual([births.id]);
    expect(validateModel(model)).toEqual([]);
  });

  test("rejects duplicate names", () => {
    const model = createEmptyModel();
    addStock(model, { name: "X" });
    expect(() => addStock(model, { name: "X" })).toThrow();
  });

  test("flow must connect to at least one stock", () => {
    const model = createEmptyModel();
    expect(() => addFlow(model, { name: "F" })).toThrow();
  });

  test("rename propagates into equations", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "Water", initialEquation: "10" });
    addFlow(model, { name: "Inflow", equation: "5", to: stock.id });
    addAuxiliary(model, { name: "Derived", equation: "Water * 2" });

    renameVariable(model, stock.id, "Volume");
    const derived = model.auxiliaries.find((a) => a.name === "Derived")!;
    expect(derived.equation).toBe("Volume * 2");
  });

  test("setEquation rejects setting equation on a stock", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "S" });
    expect(() => setEquation(model, stock.id, "1")).toThrow();
  });

  test("deleteElement cleans up references", () => {
    const model = createEmptyModel();
    const stock = addStock(model, { name: "S" });
    const flow = addFlow(model, { name: "F", to: stock.id });
    deleteElement(model, flow.id);
    expect(model.stocks[0]!.inflows).toEqual([]);
    expect(model.flows).toEqual([]);
  });

  // addFlow refuses to create a flow with neither a `from` nor a `to` stock — deleting one of
  // a flow's two connected stocks must not silently leave that invariant broken for the other
  // stock's deletion. A flow both of whose stocks were deleted (from AND to both go null) reads
  // to any XMILE reader (Vensim, Simlin, ...) as two separate, fully unconnected cloud
  // endpoints — exactly the "duplicate cloud" artifact this cascade-delete prevents.
  test("deleteElement cascades to a flow orphaned on both ends", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A" });
    const b = addStock(model, { name: "B" });
    const flow = addFlow(model, { name: "Transfer", from: a.id, to: b.id });
    const aux = addAuxiliary(model, { name: "Rate", equation: "1" });
    addConnector(model, { from: aux.id, to: flow.id });

    deleteElement(model, a.id);
    expect(model.flows).toHaveLength(1); // still connected via `to`, so it survives

    deleteElement(model, b.id);
    expect(model.flows).toEqual([]); // now orphaned on both ends — cascade-deleted
    expect(model.connectors).toEqual([]); // the relation into it goes too, not left dangling
  });

  // Deleting a stock must not disturb a flow it isn't connected to at all.
  test("deleteElement does not cascade-delete an unrelated flow", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A" });
    const b = addStock(model, { name: "B" });
    addFlow(model, { name: "Unrelated", from: b.id }); // b -> cloud, has nothing to do with a
    deleteElement(model, a.id);
    expect(model.flows).toHaveLength(1);
    expect(model.flows[0]!.from).toBe(b.id);
  });

  // An AI (or anything else calling these builders without an explicit `pos`, which is the
  // common case — a caller has no reason to compute diagram coordinates unless asked) must not
  // get every element piled on top of the others at a flat {x:0,y:0}. That's invisible until
  // something later spreads them out (a manual drag, or an auto_layout call), which reads as
  // "the position is wrong, then it changes" — see "why does the diagram jump around" fix.
  test("elements added without an explicit position don't all collide at the origin", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A" });
    const b = addStock(model, { name: "B" });
    const aux = addAuxiliary(model, { name: "Aux", equation: "1" });
    const flow = addFlow(model, { name: "F", from: a.id, to: b.id });

    const positions = [a.pos, b.pos, aux.pos, flow.pos];
    expect(a.pos).not.toEqual({ x: 0, y: 0 });
    expect(b.pos).not.toEqual({ x: 0, y: 0 });
    expect(aux.pos).not.toEqual({ x: 0, y: 0 });
    // Every element should land somewhere distinct — no two exactly on top of each other.
    const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
    expect(unique.size).toBe(positions.length);
  });
});
