# xmutil-bridge

A CLI that converts this editor's `.xmile` export into a Vensim-native `.mdl` using
[bobeberlein/xmutil](https://github.com/bobeberlein/xmutil) — Vensim's own creator's open-source
XMILE↔MDL converter — instead of this repo's own hand-written `.mdl` sketch writer
(`packages/core/src/mdl/writer.ts`).

## Why this exists

Across a long debugging session, this editor's own `.mdl` sketch writer and Vensim's own
built-in `.xmile` importer both showed flow-connectivity bugs when opened in real Vensim,
despite the exported files checking out against the OASIS XMILE spec, against
`xmutil`'s own conventions, and rendering correctly in an independent XMILE tool (Simlin). That
pointed at real limitations in Vensim's *own* import paths, not at this editor's export data.

`xmutil` is Vensim's own creator's reference implementation for exactly this conversion — the
same tool this session used to reverse-engineer the undocumented valve/flow-label pairing
convention Vensim's native sketch format relies on (see `packages/core/src/mdl/writer.ts`'s
header comments). Converting through it, rather than through Vensim's own `.xmile` importer or
this editor's own from-scratch `.mdl` writer, sidesteps both of those weaker links.

## What's vendored here, and why the Linux build works at all

The upstream `xmutil` repo only documents Qt/gyp-based builds (macOS, Windows) with no Linux
build path. But its actual *conversion* logic — everything under `third_party/xmutil/` here —
has no Qt/ICU/Boost dependency at all; those are only needed for xmutil's GUI. This is proven by
[bpowers/xmutil-rs](https://github.com/bpowers/xmutil-rs), which wraps the same C++ core as a
plain Rust `cc`-crate build (no Qt, no gyp) for its one-way `.mdl → .xmile` conversion.

`build.rs` here follows that exact recipe, extended with the additional files xmutil-rs's
one-way build didn't need: the XMILE-*reading* path (`Xmile/XmileReader.cpp`, `XmileView.cpp`,
`XmileParseFunctions.cpp`, `XmileEqLex.cpp`, `XmileEqYacc.tab.cpp`, `XmileFunctions.cpp`) and the
`.mdl`-*writing* path (`Mdl/MDLGenerator.cpp`, `Mdl/MDLFormat.cpp`), plus a few more files those
pull in transitively (`Log.cpp`, `OutputPath.cpp` — needs C++17 for `std::filesystem`, not
xmutil-rs's original C++14 — and the `Dynamo/*` files `XMUtil.cpp`'s single translation unit
links against regardless of which entry point is actually called).

All vendored source is under `third_party/`, each with its own upstream license (all
permissive: `xmutil` itself is MIT, `tinyxml2` and `libutf` are their own permissive licenses,
already present from xmutil-rs). Re-vendoring: fetch the listed files directly from
`https://raw.githubusercontent.com/bobeberlein/xmutil/master/src/...` — the `third_party/xmutil/`
layout mirrors the upstream `src/` layout exactly.

## Build and use

```sh
cargo build --release
./target/release/xmutil-bridge input.xmile output.mdl
```

## Status

Verified end-to-end against this editor's own XMILE export
(`example-compatibility/double_arrow.xmile`, the bicycle-shop exercise model): the resulting
`.mdl`'s sketch section correctly shows each flow's valve connecting to exactly one real stock
and one cloud (never two clouds), with the valve and its name-label at the required consecutive
sketch ids. **Not yet confirmed against a real Vensim install** — that's the next thing to check.
