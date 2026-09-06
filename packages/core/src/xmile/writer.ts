// Serializes a Model to XMILE (the OASIS-standard XML interchange format for system dynamics
// models — see https://docs.oasis-open.org/xmile/xmile/v1.0/xmile-v1.0.html), as an alternative
// export path to this editor's own Vensim `.mdl` writer.
//
// Why this exists alongside the `.mdl` writer: Vensim's own native sketch format encodes a
// flow's valve icon and its name label as two separate, loosely-associated shapes, and exactly
// how Vensim decides they're "the same named Rate" (rather than an orphaned label) isn't
// documented anywhere and couldn't be reverse-engineered reliably even after matching every
// measurable value (position, size, spacing) against real Vensim-drawn examples byte for byte —
// see writer.ts's compatibility notes for the full trail. XMILE's own visual model sidesteps
// this entirely: a flow's on-diagram representation is just one `<flow>` element with a
// `<pts>` list (its pipe's endpoints), no separate valve/attachment concept at all. Vensim can
// open `.xmile` files directly (File > Open, XMILE filter) using its own XMILE importer, so
// handing it a well-formed XMILE file sidesteps the undocumented sketch quirk rather than
// fighting it further.

import { exprToString, tryParseExpr } from "../mdl/expr/index.js";
import { allVariables, type Model } from "../model/types.js";

// Text content only needs `&`/`<`/`>` escaped — a literal `"` is valid inside element text and
// is exactly how real .xmile files (and Vensim's own equation syntax) quote a multi-word
// variable name inside an <eqn>, e.g. `("Teacup Temperature"-"Room Temperature")/...` in
// SDXorg/test-models' teacup.xmile. Escaping it to `&quot;` there would still be valid XML, but
// needlessly unlike every real-world example this was checked against.
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Attribute values (inside `"..."`) do need the quote character itself escaped.
function escapeXmlAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;");
}

/** Re-prints an equation through this editor's own expression parser/printer so multi-word
 * variable references come out correctly double-quoted (XMILE, like Vensim, requires quoting a
 * name that isn't a single bare identifier — e.g. `"Birth Rate"` not `Birth Rate`) — falls back
 * to the raw text verbatim for anything this editor's own parser doesn't yet model (a construct
 * already flagged in `unsupportedRaw`), rather than risk mangling it. */
function xmileEquation(model: Model, equation: string): string {
  const knownNames = allVariables(model).map((v) => v.name);
  const parsed = tryParseExpr(equation, knownNames);
  return parsed ? exprToString(parsed) : equation;
}

function tag(name: string, content: string): string {
  return `<${name}>${content}</${name}>`;
}

export function writeXmile(model: Model): string {
  let out = '<?xml version="1.0" encoding="utf-8"?>\n';
  out += '<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">\n';
  out += "  <header>\n";
  out += "    <vendor>Vensim AI Editor</vendor>\n";
  out += '    <product version="1.0">Vensim AI Editor</product>\n';
  // Spec (2.2, 2.2.1): <options> is an OPTIONAL sub-tag of <header>, but "if a file makes use
  // of any of the [listed] functionality, it MUST be listed under the <options> tag" — this
  // file always includes a <views> section below, so <has_model_view/> must be declared.
  out += "    <options>\n      <has_model_view/>\n    </options>\n";
  out += `    <name>${escapeXml(model.name)}</name>\n`;
  out += "  </header>\n";
  out += "  <sim_specs>\n";
  out += `    <start>${model.simSpec.startTime}</start>\n`;
  out += `    <stop>${model.simSpec.stopTime}</stop>\n`;
  out += `    <dt>${model.simSpec.dt}</dt>\n`;
  out += `    <method>${model.simSpec.integrationMethod}</method>\n`;
  if (model.simSpec.timeUnits) out += `    <time_units>${escapeXml(model.simSpec.timeUnits)}</time_units>\n`;
  out += "  </sim_specs>\n";
  out += "  <model>\n";
  out += "    <variables>\n";

  for (const stock of model.stocks) {
    out += `      <stock name="${escapeXmlAttr(stock.name)}">\n`;
    out += `        <eqn>${escapeXml(xmileEquation(model, stock.initialEquation))}</eqn>\n`;
    for (const id of stock.inflows) {
      const flow = model.flows.find((f) => f.id === id);
      if (flow) out += `        ${tag("inflow", escapeXml(flow.name))}\n`;
    }
    for (const id of stock.outflows) {
      const flow = model.flows.find((f) => f.id === id);
      if (flow) out += `        ${tag("outflow", escapeXml(flow.name))}\n`;
    }
    if (stock.units) out += `        ${tag("units", escapeXml(stock.units))}\n`;
    if (stock.comment) out += `        ${tag("doc", escapeXml(stock.comment))}\n`;
    out += "      </stock>\n";
  }

  for (const flow of model.flows) {
    out += `      <flow name="${escapeXmlAttr(flow.name)}">\n`;
    out += `        <eqn>${escapeXml(xmileEquation(model, flow.equation))}</eqn>\n`;
    if (flow.units) out += `        ${tag("units", escapeXml(flow.units))}\n`;
    if (flow.comment) out += `        ${tag("doc", escapeXml(flow.comment))}\n`;
    out += "      </flow>\n";
  }

  for (const aux of model.auxiliaries) {
    out += `      <aux name="${escapeXmlAttr(aux.name)}">\n`;
    out += `        <eqn>${escapeXml(xmileEquation(model, aux.equation))}</eqn>\n`;
    if (aux.units) out += `        ${tag("units", escapeXml(aux.units))}\n`;
    if (aux.comment) out += `        ${tag("doc", escapeXml(aux.comment))}\n`;
    out += "      </aux>\n";
  }

  out += "    </variables>\n";
  out += writeView(model);
  out += "  </model>\n";
  out += "</xmile>\n";
  return out;
}

function writeView(model: Model): string {
  let out = "    <views>\n";
  out += '      <view>\n';

  for (const stock of model.stocks) {
    out += `        <stock name="${escapeXmlAttr(stock.name)}" x="${Math.round(stock.pos.x)}" y="${Math.round(stock.pos.y)}"/>\n`;
  }
  for (const flow of model.flows) {
    const fromVar = flow.from ? model.stocks.find((s) => s.id === flow.from) : undefined;
    const toVar = flow.to ? model.stocks.find((s) => s.id === flow.to) : undefined;
    // A flow's pipe is just two points — the source end (a stock's position, or an open point
    // off to one side for a cloud) and the sink end. No separate valve/cloud shape is needed;
    // an endpoint with no named variable behind it is simply a bare, unconnected point.
    const rawP1 = fromVar ? fromVar.pos : { x: flow.pos.x - 60, y: flow.pos.y };
    const rawP2 = toVar ? toVar.pos : { x: flow.pos.x + 60, y: flow.pos.y };
    // Spec (6.1.2): a flow's <pts> "MUST form right angles" — the two stocks it connects can
    // sit at arbitrary, unaligned positions on the canvas, so pin the pipe to a single
    // horizontal or vertical run (whichever axis the flow actually spans more) through the
    // flow's own position rather than drawing a diagonal line between the two stock centers.
    const horizontal = Math.abs(rawP2.x - rawP1.x) >= Math.abs(rawP2.y - rawP1.y);
    const p1 = horizontal ? { x: rawP1.x, y: flow.pos.y } : { x: flow.pos.x, y: rawP1.y };
    const p2 = horizontal ? { x: rawP2.x, y: flow.pos.y } : { x: flow.pos.x, y: rawP2.y };
    out += `        <flow name="${escapeXmlAttr(flow.name)}" x="${Math.round(flow.pos.x)}" y="${Math.round(flow.pos.y)}">\n`;
    out += "          <pts>\n";
    out += `            <pt x="${Math.round(p1.x)}" y="${Math.round(p1.y)}"/>\n`;
    out += `            <pt x="${Math.round(p2.x)}" y="${Math.round(p2.y)}"/>\n`;
    out += "          </pts>\n";
    out += "        </flow>\n";
  }
  for (const aux of model.auxiliaries) {
    out += `        <aux name="${escapeXmlAttr(aux.name)}" x="${Math.round(aux.pos.x)}" y="${Math.round(aux.pos.y)}"/>\n`;
  }
  const posById = new Map<string, { x: number; y: number }>();
  for (const s of model.stocks) posById.set(s.id, s.pos);
  for (const f of model.flows) posById.set(f.id, f.pos);
  for (const a of model.auxiliaries) posById.set(a.id, a.pos);

  model.connectors.forEach((c, i) => {
    const fromVar = allVariables(model).find((v) => v.id === c.from);
    const toVar = allVariables(model).find((v) => v.id === c.to);
    if (!fromVar || !toVar) return;
    const fromPos = posById.get(c.from);
    const toPos = posById.get(c.to);
    // The `angle` attribute is REQUIRED by the XMILE spec (section 6.1.6): "The angle in
    // degrees of the takeoff point from the center of the start object. 0 is 3 o'clock and
    // angles increase counter-clockwise." Omitting it left every connector without a
    // start-point direction, which is what made Vensim's importer draw them all as identical
    // full-loop arcs. Screen y grows downward while the spec's angle is a standard
    // counter-clockwise math angle, so the dy term is negated.
    let angle = 0;
    if (fromPos && toPos) {
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
      if (angle < 0) angle += 360;
    }
    out += `        <connector uid="${i}" angle="${angle.toFixed(2)}">\n`;
    out += `          <from>${escapeXml(fromVar.name)}</from>\n`;
    out += `          <to>${escapeXml(toVar.name)}</to>\n`;
    out += "        </connector>\n";
  });

  out += "      </view>\n";
  out += "    </views>\n";
  return out;
}
