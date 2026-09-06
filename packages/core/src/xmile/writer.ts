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

import { detectLoops } from "../loops/detect.js";
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
  // file always includes a <views> section below, so <has_model_view/> must be declared, and
  // <uses_annotation/> as well whenever a freestanding <text_box> (a user's own comment, or an
  // auto-generated loop annotation/badge — see writeView) is actually emitted.
  const usesAnnotation = model.comments.length > 0 || detectLoops(model).length > 0;
  out += "    <options>\n      <has_model_view/>\n";
  if (usesAnnotation) out += "      <uses_annotation/>\n";
  out += "    </options>\n";
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
    out += `        <stock name="${escapeXmlAttr(stock.name)}" x="${Math.round(stock.pos.x)}" y="${Math.round(stock.pos.y)}" width="${Math.round(stock.size.width)}" height="${Math.round(stock.size.height)}"/>\n`;
  }
  for (const flow of model.flows) {
    const fromVar = flow.from ? model.stocks.find((s) => s.id === flow.from) : undefined;
    const toVar = flow.to ? model.stocks.find((s) => s.id === flow.to) : undefined;
    // A flow's pipe is just two points — the source end (a stock's position, or an open point
    // off to one side for a cloud) and the sink end. No separate valve/cloud shape is needed;
    // an endpoint with no named variable behind it is simply a bare, unconnected point.
    const p1 = fromVar ? fromVar.pos : { x: flow.pos.x - 60, y: flow.pos.y };
    const p2 = toVar ? toVar.pos : { x: flow.pos.x + 60, y: flow.pos.y };
    // NOTE: the spec (6.1.2) reads as if a flow's <pts> "MUST form right angles", and an
    // earlier version of this writer inserted a bend point to satisfy that whenever the two
    // ends weren't already axis-aligned. In practice that broke real Vensim imports: Vensim
    // reads a 3-point flow with an open (cloud) end as if the bend were itself a second open
    // endpoint, drawing a spurious extra cloud+arrowhead at the corner in addition to the real
    // one. A plain straight 2-point pipe — diagonal or not — is what Vensim actually handles
    // correctly (confirmed empirically), so that's what's emitted here.
    // The valve's own declared x/y is written as the exact midpoint of the pipe it's drawn on
    // — not `flow.pos` (the UI's independently-draggable label position), which can drift off
    // the actual line between the two pts once a connected stock moves. A valve that isn't on
    // its own pipe reads as ambiguous to Vensim's importer, which appears to fall back to
    // drawing an arrowhead at both ends instead of picking a direction — see writer.ts's other
    // notes on Vensim's XMILE-import quirks for the rest of that trail.
    const valveX = (p1.x + p2.x) / 2;
    const valveY = (p1.y + p2.y) / 2;
    out += `        <flow name="${escapeXmlAttr(flow.name)}" x="${Math.round(valveX)}" y="${Math.round(valveY)}" width="${Math.round(flow.size.width)}" height="${Math.round(flow.size.height)}">\n`;
    out += "          <pts>\n";
    out += `            <pt x="${Math.round(p1.x)}" y="${Math.round(p1.y)}"/>\n`;
    out += `            <pt x="${Math.round(p2.x)}" y="${Math.round(p2.y)}"/>\n`;
    out += "          </pts>\n";
    out += "        </flow>\n";
  }
  for (const aux of model.auxiliaries) {
    out += `        <aux name="${escapeXmlAttr(aux.name)}" x="${Math.round(aux.pos.x)}" y="${Math.round(aux.pos.y)}" width="${Math.round(aux.size.width)}" height="${Math.round(aux.size.height)}"/>\n`;
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

  // A freestanding annotation (spec 6.5.1: <text_box>) — a user's own comment, or an
  // auto-generated loop chain (see loops/annotate.ts's annotateLoops) — round-trips as plain
  // model text either way, so there's nothing format-specific to keep in sync between this and
  // the `.mdl` writer's own `12,` comment records: both just serialize the same `model.comments`.
  for (const c of model.comments) {
    out += `        <text_box x="${Math.round(c.pos.x)}" y="${Math.round(c.pos.y)}" width="${Math.round(c.size.width)}" height="${Math.round(c.size.height)}">${escapeXml(c.text)}</text_box>\n`;
  }

  // The small "R1"/"B1" loop-polarity badge Vensim's own sketch draws for a manually-marked
  // loop (the `.mdl` writer's loopBadgeRecord) — represented the same way here, as a tiny
  // <text_box>, so a diagram's loop labels look the same regardless of which format it was
  // opened from. Computed fresh from the model each export (not stored data) exactly like the
  // `.mdl` path, so it always reflects the current relations/flows even if `annotateLoops` was
  // never explicitly run.
  for (const loop of detectLoops(model)) {
    out += `        <text_box x="${Math.round(loop.centroid.x - 13)}" y="${Math.round(loop.centroid.y - 13)}" width="27" height="27">${loop.polarity}${loop.number}</text_box>\n`;
  }

  out += "      </view>\n";
  out += "    </views>\n";
  return out;
}
