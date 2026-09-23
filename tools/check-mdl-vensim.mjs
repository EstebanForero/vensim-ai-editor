#!/usr/bin/env node
// Checks a .mdl file against Vensim's OWN parser, without needing a Vensim install.
//
// `xmutil` is Ventana's (Vensim's creator) open-source MDL<->XMILE converter, built from the same
// codebase as Vensim itself. Reading a file with it answers the question this project keeps
// needing answered — "does real Vensim actually understand what we wrote?" — in about a second,
// instead of opening a file in the GUI and inspecting the diagram by eye. It is NOT a substitute
// for that final GUI check (xmutil doesn't render a sketch or run a simulation), but it catches
// the whole class of "our writer emitted a record shape Vensim's reader doesn't recognize" bugs,
// which is where this project's real compatibility failures have come from.
//
// Usage:
//   node tools/check-mdl-vensim.mjs path/to/model.mdl
//
// Requires the `xmutil` package (bpowers/xmutil-js, the wasm build of the same core):
//   bun add -d xmutil
//
// Exit code is 0 only if Vensim's parser accepted the file.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node tools/check-mdl-vensim.mjs <model.mdl>");
  process.exit(2);
}

let convertMdlToXmile;
try {
  ({ convertMdlToXmile } = require("xmutil"));
} catch {
  console.error("The `xmutil` package isn't installed. Run:  bun add -d xmutil");
  process.exit(2);
}

// This emscripten build resolves its .wasm through fetch(), which node's fetch refuses for a
// bare filesystem path — serve it from disk instead.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) =>
  typeof url === "string" && url.startsWith("/")
    ? new Response(readFileSync(url), { headers: { "Content-Type": "application/wasm" } })
    : realFetch(url, opts);

const mdl = readFileSync(inputPath, "utf8");

let xmile;
try {
  xmile = await convertMdlToXmile(mdl, true);
} catch (err) {
  // A parse failure comes back as a bare pointer address rather than a message (this wasm build
  // doesn't marshal xmutil's error string out), so the useful signal is the throw itself: the
  // file was rejected. Vensim's own GUI is the place to find out where.
  console.error(`Vensim's parser REJECTED ${inputPath}.`);
  console.error("(xmutil reports this as an opaque code: " + (err?.message ?? err) + ")");
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "vensim-check-"));
const outPath = join(outDir, "converted.xmile");
writeFileSync(outPath, xmile);

// What Vensim's parser actually understood, read back out of the XMILE it produced. A lookup is
// the interesting case: Vensim models one internally as a graphical function, so a `<gf>` block
// appearing here is proof the `name(<table>)` record — which carries no `=` — was read as a
// lookup and not silently skipped.
const vars = [];
for (const m of xmile.matchAll(/<(stock|flow|aux)[^>]*\sname="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
  const [, kind, name, body] = m;
  const eqn = /<eqn>([\s\S]*?)<\/eqn>/.exec(body)?.[1]?.trim();
  const gf = /<gf>([\s\S]*?)<\/gf>/.exec(body)?.[1];
  vars.push({
    kind,
    name,
    eqn,
    gf: gf ? { xpts: /<xpts>([\s\S]*?)<\/xpts>/.exec(gf)?.[1], ypts: /<ypts>([\s\S]*?)<\/ypts>/.exec(gf)?.[1] } : null,
  });
}

console.log(`Vensim's parser accepted ${inputPath}.\n`);
console.log(`${vars.length} variables read back:`);
for (const v of vars) {
  console.log(`  ${v.kind.padEnd(5)} ${v.name}`);
  if (v.eqn) console.log(`        ${v.eqn}`);
  if (v.gf) console.log(`        lookup: x=[${v.gf.xpts}] y=[${v.gf.ypts}]`);
}

const lookups = vars.filter((v) => v.gf);
console.log(`\n${lookups.length} lookup table(s) recognized.`);
console.log(`\nFull XMILE Vensim's parser produced: ${outPath}`);
console.log("(This is xmutil's own output, not this editor's — it's a window into what Vensim understood.)");
