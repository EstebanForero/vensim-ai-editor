import { describe, expect, test } from "bun:test";
import { buildArchetypeExample } from "../src/archetypes/examples.js";
import { autoLayout } from "../src/layout/autoLayout.js";
import {
  addAuxiliary,
  addComment,
  addConnector,
  addConstant,
  addFlow,
  addStock,
  clearModel,
  deleteElement,
  renameVariable,
  setEquation,
  setFlowEndpoint,
  setSimSpec,
} from "../src/model/builder/index.js";
import { allVariables, createEmptyModel, type Model, type Variable } from "../src/model/types.js";
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

  test("setFlowEndpoint re-points a flow and keeps stock inflow/outflow lists in sync", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A" });
    const b = addStock(model, { name: "B" });
    const c = addStock(model, { name: "C" });
    const flow = addFlow(model, { name: "Transfer", from: a.id, to: b.id });
    expect(a.outflows).toEqual([flow.id]);
    expect(b.inflows).toEqual([flow.id]);

    setFlowEndpoint(model, flow.id, "to", c.id);
    expect(flow.to).toBe(c.id);
    expect(b.inflows).toEqual([]); // removed from the old target
    expect(c.inflows).toEqual([flow.id]); // added to the new one
    expect(a.outflows).toEqual([flow.id]); // the untouched end is unaffected

    setFlowEndpoint(model, flow.id, "to", null); // c -> cloud
    expect(flow.to).toBeNull();
    expect(c.inflows).toEqual([]);
    expect(validateModel(model)).toEqual([]); // still connected via `from`, not orphaned
  });

  test("setFlowEndpoint refuses to leave a flow with neither end connected", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A" });
    const flow = addFlow(model, { name: "Transfer", from: a.id }); // to: cloud
    expect(() => setFlowEndpoint(model, flow.id, "from", null)).toThrow();
    expect(flow.from).toBe(a.id); // rejected — unchanged
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

  // Accents are stripped at the source, not just at .mdl export time, per an explicit decision:
  // a live Vensim session showed an accented reference inside one variable's equation ending up
  // spelled differently than that same name's own definition line elsewhere — two different
  // strings Vensim treats as two different variables, one an undefined "shadow" silently
  // carrying the real connection. Stripping wherever text enters the model (name, equation,
  // units, comment — creation, rename, and edit) means every copy of a name is the same ASCII
  // string from the moment it exists, in the app itself, not just in what gets exported.
  test("strips accents from every text field, at creation and on later edits", () => {
    const model = createEmptyModel();
    const stock = addStock(model, {
      name: "Inventario de bicicletas",
      initialEquation: "60",
      units: "bicicletas/día",
      comment: "Nivel según el último conteo",
    });
    expect(stock.name).toBe("Inventario de bicicletas");
    expect(stock.units).toBe("bicicletas/dia");
    expect(stock.comment).toBe("Nivel segun el ultimo conteo");

    const flow = addFlow(model, { name: "Recepción", equation: "5", to: stock.id });
    expect(flow.name).toBe("Recepcion");

    const aux = addAuxiliary(model, { name: "Tasa", equation: "Recepción * 2" });
    expect(aux.equation).toBe("Recepcion * 2"); // a reference to an already-stripped name

    renameVariable(model, aux.id, "Tasa de ajuste según año");
    expect(aux.name).toBe("Tasa de ajuste segun ano");

    setEquation(model, flow.id, "Tasa de ajuste según año / 2");
    expect(flow.equation).toBe("Tasa de ajuste segun ano / 2");
  });

  test("clearModel deletes every element but keeps the model's own name and sim spec", () => {
    const model = createEmptyModel("My Model");
    setSimSpec(model, { stopTime: 200, timeUnits: "Year" });
    const stock = addStock(model, { name: "S", initialEquation: "10" });
    addFlow(model, { name: "F", equation: "1", to: stock.id });
    addAuxiliary(model, { name: "A", equation: "1" });
    addConnector(model, { from: "A", to: "F" });
    addComment(model, { text: "note" });

    clearModel(model);

    expect(model.stocks).toHaveLength(0);
    expect(model.flows).toHaveLength(0);
    expect(model.auxiliaries).toHaveLength(0);
    expect(model.connectors).toHaveLength(0);
    expect(model.comments).toHaveLength(0);
    expect(model.name).toBe("My Model");
    expect(model.simSpec.stopTime).toBe(200);
    expect(model.simSpec.timeUnits).toBe("Year");

    // The model must still be usable afterward — adding a fresh element shouldn't collide with
    // anything left dangling internally by the clear.
    expect(() => addStock(model, { name: "S" })).not.toThrow();
  });
});

describe("reserved names", () => {
  // "Time" is Vensim's built-in clock. Defining a variable with that name doesn't shadow it in a
  // harmless way — this simulator seeds the clock into the same environment every variable is
  // evaluated in, so the variable replaces it and every equation reading the clock silently gets
  // that variable's value instead. Rejected at creation, on every path (all of them route through
  // assertUniqueName), so it can't be reached from the UI or from an AI tool call.
  test("a variable can't be named Time", () => {
    const m = createEmptyModel();
    expect(() => addAuxiliary(m, { name: "Time", equation: "7" })).toThrow(/reserved/i);
    expect(() => addStock(m, { name: "Time", initialEquation: "0" })).toThrow(/reserved/i);
    expect(() => addFlow(m, { name: "Time" })).toThrow(/reserved/i);
    expect(m.auxiliaries.length + m.stocks.length + m.flows.length).toBe(0);
  });

  test("reserved matches case-insensitively", () => {
    const m = createEmptyModel();
    expect(() => addAuxiliary(m, { name: "time", equation: "7" })).toThrow(/reserved/i);
    expect(() => addAuxiliary(m, { name: "TIME", equation: "7" })).toThrow(/reserved/i);
  });

  test("the control parameters are reserved too", () => {
    const m = createEmptyModel();
    expect(() => addAuxiliary(m, { name: "TIME STEP", equation: "3" })).toThrow(/reserved/i);
    expect(() => addAuxiliary(m, { name: "FINAL TIME", equation: "3" })).toThrow(/reserved/i);
  });

  test("renaming onto a reserved name is rejected", () => {
    const m = createEmptyModel();
    const a = addAuxiliary(m, { name: "Demand", equation: "5" });
    expect(() => renameVariable(m, a.id, "Time")).toThrow(/reserved/i);
    expect(a.name).toBe("Demand");
  });

  test("a model imported with one is flagged, not silently wrong", () => {
    const m = createEmptyModel();
    const a = addAuxiliary(m, { name: "Placeholder", equation: "7" });
    a.name = "Time"; // as an imported .mdl could carry it
    expect(validateModel(m).some((i) => i.elementId === a.id)).toBe(true);
  });
});

describe("where a new element lands", () => {
  /** Whether two elements' boxes overlap — the same test the canvas makes visually. */
  function overlaps(a: Variable, b: Variable): boolean {
    return (
      a.pos.x < b.pos.x + b.size.width &&
      b.pos.x < a.pos.x + a.size.width &&
      a.pos.y < b.pos.y + b.size.height &&
      b.pos.y < a.pos.y + a.size.height
    );
  }

  function clashes(model: Model, element: Variable): string[] {
    return allVariables(model)
      .filter((v) => v.id !== element.id && overlaps(v, element))
      .map((v) => v.name);
  }

  // The grid slot is named by how many elements already exist, and that is only a guess. It is a
  // bad one as soon as anything has moved the model: `autoLayout` repositions everything
  // absolutely, from the diagram's own origin, so the slot the count names is already occupied and
  // the new element was drawn *underneath* an existing one. Reported as "I added a variable and I
  // cannot see it" — which is the one thing this placement exists to prevent.
  test("it does not land on top of a laid-out model", () => {
    const model = buildArchetypeExample("limits-to-growth");
    autoLayout(model);
    const added = addConstant(model, { name: "Nueva", value: 7, units: "Second" });
    expect(clashes(model, added)).toEqual([]);
  });

  // And not on top of the one added a moment before it, which the count alone also cannot see.
  test("nor on top of the element added just before it", () => {
    const model = buildArchetypeExample("tragedy-of-the-commons");
    autoLayout(model);
    for (let i = 0; i < 3; i++) {
      const added = addConstant(model, { name: `Nueva ${i}`, value: 7, units: "Second" });
      expect({ i, clashes: clashes(model, added) }).toEqual({ i, clashes: [] });
    }
  });
});
