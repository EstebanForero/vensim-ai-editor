# @vensim-ai/cli

Generate a system-dynamics model from a description, without opening the editor.

```
bun run generate make a model of a coffee shop queue
bun run generate "the commons: three farms on one aquifer" -o aquifer.mdl
cat idea.txt | bun run generate
bun run generate "add a delay to the hiring loop" --from hiring.mdl -o hiring-2.mdl
```

It runs the same agent the app's chat panel runs — same loop, same system prompt, same tools
(`@vensim-ai/agent`) — and writes the result to a `.mdl` (or XMILE) file. What it does *not* have
is a canvas, a simulation chart or a transcript: it is the generation half, headless.

## Credentials

Flags first, then the environment, then the provider preset:

| | |
|---|---|
| `VENSIM_AI_API_KEY` | tried first, for any provider |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | each provider's own variable |
| `VENSIM_AI_PROVIDER`, `VENSIM_AI_MODEL`, `VENSIM_AI_BASE_URL` | same as the flags below |

```sh
export VENSIM_AI_PROVIDER=deepseek
export VENSIM_AI_API_KEY=sk-...
bun run generate a model of a hospital waiting list
```

Ollama needs no key at all — passing an empty one is fine.

## Output

Stdout is the result (the path, then a summary); stderr is everything else, so the progress stays
readable while `> file` and `| jq` still do the obvious thing. The summary is read back out of the
finished model with the same analysers the app reports with — element counts, feedback loops, and
any archetype its loops match — so a generated file can be judged without opening it:

```
/build/aquifer.mdl
  1 stock, 3 flows, 5 auxiliaries, 9 relations
  3 feedback loops (R1, B1, B2)
  archetypes: Tragedy of the Commons
  12.4s
```

## Layout

Each file does one job, so extending it means adding to a table or a function rather than editing
several places that have to agree:

| file | owns |
|---|---|
| `cli.ts` | the wiring: parse, resolve, run, write, exit code |
| `args.ts` | the flag table — parsing, validation and `--help` all read from it |
| `config.ts` | which provider, endpoint and key a given command line and environment resolve to |
| `run.ts` | one agent turn, from the starting model to the finished one |
| `progress.ts` | what the run looks like from the terminal |
| `summary.ts` | what was made, read back from the file |
| `formats.ts` | the output formats |
| `python.ts` | the `run_python` interpreter |

Adding a flag is a row in `args.ts`. Adding a format is an entry in `formats.ts`. Adding a
provider is a row in `@vensim-ai/agent`'s `providerPresets.ts`, which the app's settings panel
reads too.

## `run_python` runs on this machine

The agent's `run_python` tool exists so the model can check its own work — that a stock stays
positive, that a rate converges where the equations imply it should. In the browser that code runs
in Pyodide, a WASM sandbox inside the page. Here it runs through your own `python3`, as you, with
your permissions, in a temporary directory that is deleted afterwards and killed after 30 seconds.

That is the same trust the tool already implies (the model tools can write any file you can), but
it is a real difference from the app and worth knowing before you run it on a prompt you did not
write. If no interpreter is on `PATH`, the tool tells the model so and the run carries on with
`run_simulation` and `check_units` alone.
