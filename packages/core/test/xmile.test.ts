import { describe, expect, test } from "bun:test";
import { addAuxiliary, addComment, addConnector, addFlow, addStock } from "../src/model/builder/index.js";
import { annotateLoops } from "../src/loops/annotate.js";
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

  test("keeps a flow's <pts> as a plain 2-point pipe on the stocks' real positions, even diagonally", () => {
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

    // The pipe's ends must stay exactly on the stocks they connect. A 3-point bent pipe was
    // tried here to satisfy a strict reading of the spec's "MUST form right angles" language,
    // but real Vensim reads a bend on a flow with an open (cloud) end as if it were itself a
    // second open endpoint, drawing a spurious extra cloud+arrowhead — so this stays a plain
    // 2-point pipe, diagonal or not.
    expect(pts).toEqual([
      { x: 100, y: 100 },
      { x: 400, y: 250 },
    ]);
  });

  // Regression: the writer used to declare the flow's own x/y (its valve's position) as the
  // model's independently-draggable `flow.pos`, which drifts off the actual pipe once a
  // connected stock moves — a valve that isn't on its own pipe is exactly the kind of malformed
  // XMILE that real-world testing showed Vensim's importer rendering as a double-headed arrow
  // instead of picking a single direction. The declared position must always be the exact
  // midpoint of the two <pts>, regardless of where flow.pos itself has drifted to.
  test("declares the flow's own x/y as the exact midpoint of its <pts>, not the (possibly stale) UI drag position", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A", initialEquation: "0" });
    a.pos = { x: 0, y: 100 };
    const flow = addFlow(model, { name: "Outflow", equation: "1", from: a.id }); // to: cloud sink
    flow.pos = { x: 9999, y: -9999 }; // simulate a label dragged far off the actual pipe

    const xml = writeXmile(model);
    const flowTag = xml.match(/<flow name="Outflow" x="(-?\d+)" y="(-?\d+)" width="\d+" height="\d+">/);
    expect(flowTag).not.toBeNull();
    const declaredX = Number(flowTag![1]);
    const declaredY = Number(flowTag![2]);

    const pts = [...xml.matchAll(/<pt x="(-?\d+)" y="(-?\d+)"\/>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    expect(pts).toHaveLength(2);
    expect(declaredX).toBe(Math.round((pts[0]!.x + pts[1]!.x) / 2));
    expect(declaredY).toBe(Math.round((pts[0]!.y + pts[1]!.y) / 2));
  });

  test("exports comments (including auto-generated loop annotations) as <text_box>, and declares uses_annotation", () => {
    const model = createEmptyModel();
    const pop = addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * 0.02", to: pop.id });
    addConnector(model, { from: "Population", to: "Births" });
    addComment(model, { text: "Hand-written note", pos: { x: 10, y: 20 }, size: { width: 100, height: 40 } });
    annotateLoops(model);

    const xml = writeXmile(model);
    expect(xml).toContain("<uses_annotation/>");
    expect(xml).toContain('<text_box x="10" y="20" width="100" height="40">Hand-written note</text_box>');
    expect(xml).toContain("R1 loop: Population → Births → Population");
    // the small loop-polarity badge is exported too, distinct from the longer annotation
    expect(xml).toMatch(/<text_box x="-?\d+" y="-?\d+" width="27" height="27">R1<\/text_box>/);
  });

  // Regression: the writer used to omit width/height on <stock>/<flow>/<aux> entirely, which
  // is valid XMILE (they default to a shape-appropriate size per spec 5.1.2) — but real-world
  // testing through xmutil (Vensim's own creator's XMILE->MDL converter, see
  // tools/xmutil-bridge) showed it carries the *absence* of width/height straight through as a
  // literal 0, producing an .mdl where every shape (not just flows) is zero-sized and simply
  // doesn't render in Vensim at all — a much worse failure than the mis-wired connections this
  // was previously debugged for. Always emitting each element's own real size sidesteps relying
  // on a reader applying a sensible default that this one demonstrably doesn't.
  test("stocks, flows, and auxiliaries always declare a real width/height, never left to default", () => {
    const model = createEmptyModel();
    const a = addStock(model, { name: "A", initialEquation: "0" });
    addFlow(model, { name: "F", equation: "1", to: a.id });
    addAuxiliary(model, { name: "Aux", equation: "1" });

    const xml = writeXmile(model);
    for (const tag of ["stock", "flow", "aux"]) {
      const match = xml.match(new RegExp(`<${tag} [^>]*width="(\\d+)" height="(\\d+)"`));
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
      expect(Number(match![2])).toBeGreaterThan(0);
    }
  });
});
