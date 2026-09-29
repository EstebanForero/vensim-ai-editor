# Vensim AI Editor

A web-based system-dynamics editor, compatible with Vensim's `.mdl` file format, that a human
or an AI can both edit through the same structured model API — in the spirit of
[Simlin](https://simlin.com), plus an in-app AI chat panel that builds diagrams for you.

## Packages

- `packages/core` — the model schema, Vensim `.mdl` parser/writer, expression language,
  Euler/RK4 simulation engine, and feedback-loop detector. No UI dependencies; runs anywhere
  Bun/Node runs.
- `packages/ai-tools` — a provider-agnostic tool-use schema (`add_stock`, `add_flow`,
  `add_auxiliary`, `add_constant`, `add_relation`, `set_relation_polarity`, `set_equation`,
  `rename_variable`, `move_element`, `delete_element`, `list_model`, `run_simulation`,
  `list_loops`) and an executor that applies them to a `core` model.
- `packages/agent` — the AI agent itself: the tool-calling loop, the OpenAI-compatible and
  Gemini backends, the system prompt, and the provider presets. Shared by the app and the CLI, so
  neither owns a second implementation of how a turn works.
- `apps/web` — the editor itself: React + React Flow diagram canvas with inline rename,
  manually-curvable relations, comment annotations, auto-detected feedback-loop badges, a
  simulation chart panel, and an AI chat panel that drives the model via `ai-tools` over any
  OpenAI-compatible chat-completions API.
- `apps/cli` — the same agent without the editor: one prompt in, one model file out. See
  [its README](apps/cli/README.md).

## Getting started

```bash
bun install
bun run dev        # starts apps/web on http://localhost:5173
bun test           # every package's test suite
bun run typecheck  # tsc --noEmit across all packages
bun run generate   # the CLI — see below
```

To use the AI chat panel, paste an API key into the field at the top of the "AI Chat" tab —
it's stored only in your browser's `localStorage` and sent directly to whatever endpoint you
configure, never to any other server. The gear icon next to the key field lets you change the
Base URL and Model, so it works with OpenAI itself or any server that exposes an
OpenAI-compatible `/chat/completions` route (Azure OpenAI, OpenRouter, vLLM, Ollama, LM
Studio, …). Defaults to `https://api.openai.com/v1` and `gpt-4o`.

## CLI

Generate a model from a description without opening the editor. It runs the same agent the chat
panel runs — same loop, same tools, same providers — and writes the result to a `.mdl` (or XMILE)
file.

```bash
bun run generate make a model of a coffee shop queue     # the prompt is every bare word
bun run generate "the commons: three farms on one aquifer" -o aquifer.mdl
bun run generate "add a delay to the hiring loop" --from hiring.mdl -o hiring-2.mdl
cat idea.txt | bun run generate                          # or pipe the prompt in
bun run generate --help                                  # every flag, provider and format
```

It needs an API key, in the environment rather than in the app's settings:

```bash
export VENSIM_AI_API_KEY=sk-...              # or OPENAI_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY / …
export VENSIM_AI_PROVIDER=deepseek           # optional; OpenAI is the default
```

Stdout is the result and stderr the progress, so `> file` and `| jq` do the obvious thing:

```
/build/aquifer.mdl
  1 stock, 3 flows, 5 auxiliaries, 9 relations
  3 feedback loops (R1, B1, B2)
  archetypes: Tragedy of the Commons
  12.4s
```

[`apps/cli/README.md`](apps/cli/README.md) is the full guide — the flows with their output, exit
codes, how the pipeline works, and where to add a flag, a format or a provider.

## Study tab

A fifth panel beside Inspector / AI Chat / Simulation / Text, for practising on models rather than
editing them: build one from a described situation, write the equations for it, judge a model
against what it was supposed to be, hunt for wrong signs and units, name the archetype, list the
loops, or have an exercise set for you.

It is the same agent as the chat panel — same loop, same tools, same connection — with a different
brief. Each mode is a row in `apps/web/src/study/modes.ts`: a system prompt, the tools the turn may
use, and what the mode expects you to bring. Adding one is adding a row; the panel has no idea what
any particular mode does.

The modes that *judge* a model are not given the tools that change it. That is the difference
between asking a model not to rewrite your work and leaving it no way to — the tool list is what
the turn is offered, so a "find the mistakes" turn can be pointed at the model you are actually
working on without risk. A test asserts every tool the agent has is classified as one or the other,
so a tool added later can't slip into a read-only mode unclassified.

### Drills

Asking an expert is not practice at being one. Every mode above *answers* — "Which archetype?"
names it, "Find the mistakes" finds them — and none of them ever asks you anything, which left the
obvious gap: the mode for recognising an archetype had nothing to recognise, and on an empty canvas
nothing to say at all.

So the tab has a second row of chips, **Practise**, above the modes. A drill is a question the app
asks and marks itself. No API key, no agent, and the mark is a *comparison* rather than a judgement:
every question carries the answer an analyser produced — `detectLoops`, `detectArchetypes`,
`checkUnits`, `equationDependencies`, `simulate` — and records which one, so a wrong mark can be
traced back to the thing that produced it rather than to a sentence somebody wrote.

- **Identify the archetype** — reads you a short situation and asks which pattern it is. Situations
  need no model, so this is the one drill that works from a cold start.
- **Read the loops** — how many, reinforcing or balancing, which way round on the canvas, and what is
  in each one.
- **Numbers and units** — what depends on what, what a stock reaches by the end of the run, whether
  it goes negative, and which variable has a units problem.
- **Mixed practice** — all three, interleaved. Blocking by skill feels better and retains worse.

A sitting is questions from one pool in turn, marked as you go, with the explanation shown whatever
you answered. Where a model's structure is ambiguous — and most are, since `detectArchetypes`
reports candidates rather than verdicts — the drill stays quiet rather than marking a defensible
reading wrong.

The questions and the marking live in `packages/core/src/drills/`, so they are testable without a
browser and usable by anything that has a model. A drill is a row in
`apps/web/src/study/drill/modes.ts`. Nothing in there can change what is on the canvas: practising
cannot alter what the editor does.

`apps/web/src/study/` is self-contained and the dependency runs one way: it uses the editor (the
store, the canvas, the shared chat rendering), and the editor imports exactly one thing back —
`StudyPanel`, rendered as one more tab. Deleting the folder costs two lines in `App.tsx`.

## Vensim compatibility

The `.mdl` codec covers the core arithmetic/equation subset Vensim uses for stocks (`INTEG`),
flows, and auxiliaries, plus the control block (`FINAL TIME`, `INITIAL TIME`, `TIME STEP`,
`SAVEPER`) and a best-effort read/write of the sketch section for diagram layout. Subscripted
(array) variables and macros are not modeled yet — opening a file that uses them won't crash, but
those constructs won't simulate or render. Lookup tables are modelled, and so are `DELAY1`,
`DELAY3`, `DELAY N`, `SMOOTH` and `SMOOTH3` (expanded into stocks and flows before simulating, so
they integrate alongside the model's own levels); `DELAY FIXED` and the explicit-initial `DELAY1I`
family are not.

## Causal relations and feedback loops

Any two variables can be linked with a signed **relation** (Vensim's information-link arrow) —
via the toolbar's "Relation" mode (click a source, then a target) or by dragging between node
handles on the canvas. Each relation carries a polarity, `+` (increases) or `-` (decreases),
editable in the Inspector when the relation is selected. A pure causal-loop diagram — no
stocks or flows, just auxiliaries and signed relations — works the same way.

Whenever the model changes, `detectLoops` (in `packages/core/src/loops`) walks the graph
formed by relations plus each flow's connection to its stock (an inflow is a "+" edge into the
stock, an outflow a "-" edge) and enumerates its feedback loops. Each loop is labeled:

- **R (Reinforcing)** if it has an even number of `-` relations around the cycle, **B
  (Balancing)** if odd — the standard system-dynamics convention.
- A visual rotation, **clockwise** or **counterclockwise**, computed from the loop variables'
  current diagram positions (via the shoelace formula), which picks the badge's rotation icon.

Badges are placed at each loop's centroid and toggle on/off with the toolbar's "Loops" button.
The AI can also call `list_loops` to read back the same information before deciding what to
change next.

### Also visible in real Vensim

Loop badges and curved relations aren't only a canvas overlay in this app — `.mdl` files
saved here carry them into native Vensim too:

- Every detected loop is written as a freestanding text annotation (`12,` sketch record) at
  the loop's centroid, using Vensim's own "Comment" mechanism for text that isn't tied to any
  variable's equation — it shows up as an "R ↻" / "B ↺"-style label on the diagram when opened
  in Vensim, same as this editor's badges.
- Relation (connector) arrows are written with a curved bend point rather than a straight
  line, so they read the same way in Vensim as they do on this editor's canvas.

The exact sketch-record fields for both are a best-effort reconstruction (see the comment at
the top of `packages/core/src/mdl/writer.ts`) rather than a verified byte-exact match against
Vensim's own writer — if something looks off when you open an exported file in real Vensim,
that's the file to fix.

## No separate "Constant" element

Like Vensim, there's no distinct Constant kind on the diagram or in the toolbar — a "Variable"
(an Auxiliary) reads as a constant whenever its equation has no dependencies (a bare number, or
an expression of only literals/functions), computed on demand by `isConstantAuxiliary` in
`packages/core/src/model/derived.ts` rather than stored as a flag that equation edits could
leave stale. `add_constant` still exists as an ergonomic tool/builder shortcut for setting a
plain numeric equation in one call — it doesn't create a different kind of element.

## Extending the equation language

Vensim functions the equation language doesn't cover yet (or a project-specific function) are
added via `registerFunction` in `packages/core/src/mdl/expr/functions.ts` — the evaluator has
no per-function special cases to touch; every call, including time-aware ones like `STEP` and
`PULSE`, is a lookup into this registry. It's a code-level extension point for embedders, not
something wired to AI or other runtime input: a function's implementation is an arbitrary JS
closure, so only register ones you wrote yourself.
