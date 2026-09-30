# @vensim-ai/cli

Generate a system-dynamics model from a description, without opening the editor — one prompt in and
one file out, or a session you talk to until the model is what you meant.

It runs the same agent the app's chat panel runs — same loop, same system prompt, same tools
(`@vensim-ai/agent`) — and writes the result to a `.mdl` (or XMILE) file. What it does *not* have
is a canvas, a simulation chart or a transcript: it is the generation half, headless.

- [Using it](#using-it) — the flows, with what they print
- [Credentials](#credentials)
- [Output](#output) — what the summary means
- [How it works](#how-it-works) — the pipeline, and where to change what
- [`run_python` runs on this machine](#run_python-runs-on-this-machine)

## Using it

Everything below runs from the repository root, via `bun run generate` (which is
`bun run --cwd apps/cli start`) or directly as `bun apps/cli/src/cli.ts`.

**Build something.** The prompt is every word that isn't a flag, so no quotes are needed:

```console
$ bun run generate make a model of a coffee shop queue
Building with gpt-4o at https://api.openai.com/v1…
  → add_stock
  → add_flow
  → add_auxiliary
  → add_relation
  → run_python
  ✓ run_python code=print('queue stays non-negative:', all(v >= 0 for v…
Built it. A stock-and-flow model of a single-server queue: arrivals are an …
/build/a-coffee-shop-queue.mdl
  3 stocks, 4 flows, 6 auxiliaries, 11 relations
  2 feedback loops (B1, R1)
  archetypes: Limits to Growth
  41.2s
```

The file lands in the working directory, named after the model. `-o` overrides both:

```sh
bun run generate "the commons: three farms on one aquifer" -o aquifer.mdl
bun run generate "a hospital waiting list" -o /tmp/waiting.mdl --format xmile
```

**Revise an existing one.** `--from` starts the agent on a model you already have, so it edits
rather than builds from nothing:

```sh
bun run generate "add a delay to the hiring loop" --from hiring.mdl -o hiring-2.mdl
bun run generate "the burnout loop is missing a link to quality" -f hiring.mdl
```

**Talk to it.** With no prompt on a terminal there is nothing to generate from and someone sitting
at the keyboard, so the command opens a session instead of running once. `-i`/`--chat` says so
explicitly, and a prompt alongside it becomes the opening message rather than the whole job:

```console
$ bun run generate --chat -o queue.mdl            # or: --chat "a single-server queue"
Chatting with gpt-4o at https://api.openai.com/v1. /help for commands, /exit to leave.
Nothing on the canvas yet — say what to build.

> a single-server queue, arrivals rise in winter
  → add_stock
  ✓ add_stock name=Queue initial_equation=0 units=People
  → add_flow
  ✓ add_flow name=Arrivals equation=Arrival rate to=Queue units=People/Month
  …
  …

> /model
A single-server queue, arrivals rise in winter
  1 stock, 2 flows, 3 auxiliaries, 4 relations
  2 feedback loops (B1, R1)

> now make the server go on holiday for two weeks a year
  → set_equation
  ✓ set_equation name=Service rate equation=…
  …

> /exit
/build/queue.mdl
  1 stock, 2 flows, 3 auxiliaries, 4 relations
  2 feedback loops (B1, R1)
  38.4s
```

The `…` lines are the agent's own account of what it did — text, streamed as it arrives, `>`
marking what you typed.

What is kept between turns is the *conversation and the model*: the same session and the same
model objects, the same agent, the same tools. So "make the server go on holiday" edits the model
the first turn built, and "why does that loop dominate?" refers to the loop it just named. Nothing
is re-described and nothing is re-read from disk.

The commands are `/model` (what is on the canvas: elements, loops, archetypes), `/save [path]`
(write the file now, without ending the session), `/help` and `/exit`. Anything else is a message.
Ctrl-C stops the turn that is running — the model and the conversation survive it, as they do
behind the app's Stop button — and at the prompt it leaves.

The file is written when the session ends, exactly as a one-shot run writes it, so `/exit`, Ctrl-D
and Ctrl-C all leave the model somewhere it can be opened. `-o`, `--format` and `--from` mean what
they mean elsewhere; `-q` drops the tool lines and keeps the conversation.

**Pipe the prompt.** From a file, or from another command:

```sh
cat exercise.txt | bun run generate -o answer.mdl
pbpaste | bun run generate
```

**Quiet, for scripting.** `-q` drops the progress lines, leaving only the result on stdout:

```sh
out=$(bun run generate "a predator-prey model" -q) && echo "$out" | head -1
```

**Other providers.** `--provider` picks a preset; the key comes from the environment:

```sh
export VENSIM_AI_PROVIDER=deepseek VENSIM_AI_API_KEY=sk-…
bun run generate "a model of technical debt"          # deepseek-chat
bun run generate "a model of technical debt" --model deepseek-reasoner
```

`bun run generate --help` lists every flag, the providers, and the formats.

## Credentials

Flags first, then the environment, then a `.env` file, then the provider preset:

| | |
|---|---|
| `--api-key` and the other flags | whatever is passed on the command line |
| `VENSIM_AI_API_KEY` | tried first, for any provider, from the environment or the file |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | each provider's own variable |
| `VENSIM_AI_PROVIDER`, `VENSIM_AI_MODEL`, `VENSIM_AI_BASE_URL` | same as the flags |
| `VENSIM_AI_REASONING` | `low`, `medium` or `high` — sent only when set to one of those |

**The `.env` file** is the one to use if you'd rather not export anything: copy `.env.example` at the
repository root, fill in the key, and every run picks it up. It reads the nearest `.env` at or above
the directory the command is run from — stopping at the top of the repository — so the one at the
root covers both `bun run generate` and `bun start` (which runs from this directory).

What is already in the environment wins over the file. An exported key, or one passed inline
(`DEEPSEEK_API_KEY=… bun run generate`), is a decision about that one run; a file left in the
repository is a default, and a stale one in it silently beating the key you just passed would be
the worst thing a config file could do. Which file was read is printed at the start of a run
(`-q` silences it), and if no key is found anywhere the error names the file it looked in.

Ollama needs no key at all — passing an empty one is fine, though the variable does have to be
*set*, since "unset" is what the error is made of. The key is never written anywhere by the CLI: it
goes from the file or the environment to the endpoint you configured, and no further.

## Output

**Stdout is the result; stderr is everything else.** A run's narration — the tool calls, the
agent's own summary — goes to stderr, so `> file` and `| jq` do the obvious thing while you still
watch the work happen. `-q` silences stderr entirely.

The summary is read back out of the *finished model* with the same analysers the app reports with
(`detectLoops`, `detectArchetypes`), so a generated file can be judged without opening it:

```
/build/aquifer.mdl
  1 stock, 3 flows, 5 auxiliaries, 9 relations
  3 feedback loops (R1, B1, B2)
  archetypes: Tragedy of the Commons
  12.4s
```

Exit codes: **0** wrote a file, **1** the run failed (nothing written), **2** the command line
itself was wrong — a bad flag, no key, an unknown provider. Each is reported with what to do about
it rather than a stack trace.

A chat that ends without a model exits **0**, not 1: a one-shot run that produced nothing failed
at what it was asked to do, while a conversation that went nowhere in particular is not an error
to report to the shell. Nothing is written either way, and it says so.

## How it works

One turn of the agent, start to finish:

```
argv ──▶ args ──▶ config ──▶ run ─────────────────────────▶ summary
         │         │          │  │                           │
         │         │          │  └─ the model, mutated in place by the tool calls
         │         │          └──── the loop in @vensim-ai/agent: ask the model,
         │         │                execute whatever tools it calls, ask again
         │         └─────────────── which provider, endpoint and key, from flags/env/preset
         └───────────────────────── flags from one table; the prompt is every bare word
```

The model is built up **in memory** by tool calls — `add_stock`, `set_equation`, `add_relation`,
and so on — exactly as the app's chat panel builds one on the canvas. Only at the end is it
written out (`formats.ts`), which is why a failed or empty run writes nothing rather than an empty
file.

Each file does one job, so extending it means adding to a table or a function rather than editing
several places that have to agree:

| file | owns | to add… |
|---|---|---|
| `cli.ts` | the wiring: parse, resolve, run, write, exit code | — |
| `args.ts` | the flag table — parsing, validation and `--help` all read from it | **a flag**: one row |
| `chat.ts` | a session: reading lines, the `/`-commands, and what is kept between turns | **a command**: one row |
| `config.ts` | which provider, endpoint and key a command line and environment resolve to | **a provider**: a row in `@vensim-ai/agent`'s presets (the app's settings panel reads the same table) |
| `run.ts` | one agent turn, from the starting model to the finished one | — |
| `progress.ts` | what the run looks like from the terminal | **a presentation**: another reporter with the same shape |
| `summary.ts` | what was made, read back from the file | **a line in the summary** |
| `formats.ts` | the output formats | **a format**: one entry |
| `output.ts` | where a model is written, and what it is called there | — |
| `envfile.ts` | finding and reading a `.env`, and which of it the environment already has | **a syntax**: `parseEnvFile` |
| `python.ts` | the `run_python` interpreter | — |

Tests: `test/cli.test.ts` drives the real command as a subprocess against a mock OpenAI-compatible
endpoint — argument passing, exit codes, the file landing where it says — and `test/units.test.ts`
covers the pure parts (parsing, naming, credential resolution) where a subprocess would only infer
them from output.

## `run_python` runs on this machine

The agent's `run_python` tool exists so the model can check its own work — that a stock stays
positive, that a rate converges where the equations imply it should. In the browser that code runs
in Pyodide, a WASM sandbox inside the page. Here it runs through your own `python3`, as you, with
your permissions, in a temporary directory that is deleted afterwards and killed after 30 seconds.

That is the same trust the tool already implies (the model tools can write any file you can), but
it is a real difference from the app and worth knowing before you run it on a prompt you did not
write. If no interpreter is on `PATH`, the tool says so and the run carries on with
`run_simulation` and `check_units` alone.
