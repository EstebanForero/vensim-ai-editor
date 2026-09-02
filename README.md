# Vensim AI Editor

A web-based system-dynamics editor, compatible with Vensim's `.mdl` file format, that a human
or an AI can both edit through the same structured model API — in the spirit of
[Simlin](https://simlin.com), plus an in-app AI chat panel that builds diagrams for you.

## Packages

- `packages/core` — the model schema, Vensim `.mdl` parser/writer, expression language, and
  Euler/RK4 simulation engine. No UI dependencies; runs anywhere Bun/Node runs.
- `packages/ai-tools` — Anthropic tool-use definitions (`add_stock`, `add_flow`,
  `add_auxiliary`, `add_constant`, `add_connector`, `set_equation`, `rename_variable`,
  `move_element`, `delete_element`, `list_model`, `run_simulation`) and an executor that applies
  them to a `core` model.
- `apps/web` — the editor itself: React + React Flow diagram canvas, an equation inspector, a
  simulation chart panel, and an AI chat panel that drives the model via `ai-tools`.

## Getting started

```bash
bun install
bun run dev        # starts apps/web on http://localhost:5173
bun test            # runs packages/core and packages/ai-tools test suites
bun run typecheck   # tsc --noEmit across all packages
```

To use the AI chat panel, paste an Anthropic API key into the field at the top of the "AI Chat"
tab — it's stored only in your browser's `localStorage` and sent directly to Anthropic's API,
never to any other server.

## Vensim compatibility

The `.mdl` codec covers the core arithmetic/equation subset Vensim uses for stocks (`INTEG`),
flows, and auxiliaries, plus the control block (`FINAL TIME`, `INITIAL TIME`, `TIME STEP`,
`SAVEPER`) and a best-effort read/write of the sketch section for diagram layout. Subscripted
(array) variables, macros, lookup tables, and DELAY/SMOOTH-family builtins are not modeled yet —
opening a file that uses them won't crash, but those constructs won't simulate or render.
