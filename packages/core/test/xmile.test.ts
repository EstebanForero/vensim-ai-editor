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

    // Spec (2.2.1): any file using view-related functionality "MUST be listed under the
    // <options> tag" — this writer always emits a <views> section, so <has_model_view/> must
    // be declared in the header.
    expect(xml).toContain("<has_model_view/>");

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

    // `angle` is REQUIRED by the XMILE spec (6.1.6): "The angle in degrees of the takeoff
    // point from the center of the start object." Omitting it is what made Vensim's importer
    // draw every connector as an identical full-loop arc instead of a straight/curved line
    // toward its actual target.
    expect(xml).toMatch(/<connector uid="\d+" angle="[\d.]+">/);

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

  test("bends a flow's <pts> at a right angle, without moving its endpoints, when the stocks it connects sit diagonally", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A", initialEquation: "0" });
    a.pos = { x: 100, y: 100 };
    const b = addStock(model, { name: "B", initialEquation: "0" });
    b.pos = { x: 400, y: 250 }; // not aligned with A on either axis
    addFlow(model, { name: "Transfer", equation: "1", from: a.id, to: b.id });

    const xml = writeXmile(model);
    const pts = [...xml.matchAll(/<pt x="(-?\d+)" y="(-?\d+)"\/>/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    // The pipe's ends must stay exactly on the stocks they connect — a flow floating away from
    // its own stocks is the regression this test guards against.
    expect(pts[0]).toEqual({ x: 100, y: 100 });
    expect(pts[pts.length - 1]).toEqual({ x: 400, y: 250 });

    // Spec (6.1.2): a flow's <pts> "MUST form right angles" — every consecutive pair of points
    // must share an x or a y coordinate.
    for (let i = 1; i < pts.length; i++) {
      const [prev, cur] = [pts[i - 1]!, pts[i]!];
      expect(prev.x === cur.x || prev.y === cur.y).toBe(true);
    }
  });
});
