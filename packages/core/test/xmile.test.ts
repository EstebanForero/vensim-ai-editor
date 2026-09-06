import { describe, expect, test } from "bun:test";
import { addAuxiliary, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { createEmptyModel } from "../src/model/types.js";
import { writeXmile } from "../src/xmile/writer.js";

describe("XMILE writer", () => {
  test("writes a well-formed XMILE document for a two-stock flow", () => {
    const model = createEmptyModel("XmileTest");
    const a = addStock(model, { name: "A", initialEquation: "100" });
    const b = addStock(model, { name: "B", initialEquation: "0" });
    addFlow(model, { name: "Transfer", equation: "5", from: a.id, to: b.id });
    const rate = addAuxiliary(model, { name: "Rate", equation: "0.1" });
    addConnector(model, { from: rate.id, to: "Transfer", polarity: "+" });

    const xml = writeXmile(model);

    expect(xml).toContain('<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">');

    // A flow between two real stocks appears as an <outflow>/<inflow> on each stock (XMILE's
    // own convention, confirmed against real .xmile files from SDXorg/test-models) — this is
    // the exact case that kept breaking in the Vensim `.mdl` sketch format, since XMILE's flow
    // display is just two points, with no separate valve/attachment concept to get wrong.
    expect(xml).toContain("<outflow>Transfer</outflow>");
    expect(xml).toContain("<inflow>Transfer</inflow>");

    // The causal relation into the flow is a plain <connector><from>/<to>, addressing the flow
    // by its own name directly — no valve-vs-label id ambiguity exists in this format at all.
    expect(xml).toContain("<from>Rate</from>");
    expect(xml).toContain("<to>Transfer</to>");

    // No dangling tags — every opened (non-self-closing) tag has a matching close.
    const opens = [...xml.matchAll(/<([a-z_]+)(?:\s[^>]*)?(?<!\/)>/g)].map((m) => m[1]);
    const closes = [...xml.matchAll(/<\/([a-z_]+)>/g)].map((m) => m[1]);
    for (const tag of new Set(opens)) {
      const openCount = opens.filter((t) => t === tag).length;
      const closeCount = closes.filter((t) => t === tag).length;
      expect(openCount).toBe(closeCount);
    }
  });

  test("quotes multi-word variable names in equations, matching XMILE/Vensim's own convention", () => {
    const model = createEmptyModel();
    addAuxiliary(model, { name: "Birth Rate", equation: "0.02" });
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * Birth Rate", to: pop.id });

    const xml = writeXmile(model);
    expect(xml).toContain('Population * "Birth Rate"');
  });
});
