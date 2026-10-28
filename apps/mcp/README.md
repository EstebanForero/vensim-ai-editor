# @vensim-ai/mcp

An MCP server so another agent can edit a Vensim model with this project's tools, or ask this
project's own agent to do it.

`bun run dev` starts this server next to the editor, and `bun run mcp` starts it on its own. Either
way the process prints a link, and the editor shows the same one:

```
http://127.0.0.1:8787/mcp
```

Paste that URL into a client that connects to a remote MCP server. The process keeps one model in
memory until it exits. Calls to `add_stock`, `add_flow`, `set_equation`, `run_simulation`,
`run_python`, and the other tools from `@vensim-ai/agent` change that model directly — the same
executor the editor and the CLI use. Nothing is written to disk until `save_mdl`. The diagram on
the canvas is a separate model; pass a `.mdl` through `load_mdl` / `save_mdl` to move work between
them.

`ask_agent` is the other way in. It runs one turn of the built-in agent against the same model, with
the same system prompt and the same tools, and returns the assistant's reply plus the tool calls it
made. A later `ask_agent` continues that conversation; `fresh: true` starts a new one.

## Run it

From the repository root:

```bash
bun run dev    # editor and MCP server; the link is printed and shown in the toolbar
bun run mcp    # the MCP server alone, printing the same link
```

The HTTP process logs to stderr and prints the link on stdout. A client that has to spawn a
process instead uses the stdio entry, `bun apps/mcp/src/main.ts`. That one must not print anything
on stdout, so it does not show a link.

`ask_agent` needs the same credentials as `bun run generate`: a `.env` at the repository root, or
the variables in the environment the host launches the server with. `VENSIM_AI_API_KEY` wins over
the provider's own key (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, …). `VENSIM_AI_PROVIDER`,
`VENSIM_AI_BASE_URL`, `VENSIM_AI_MODEL`, and `VENSIM_AI_REASONING` work the same way as in the CLI.
An xAI model is the Custom provider: set `VENSIM_AI_BASE_URL` to `https://api.x.ai/v1` and
`VENSIM_AI_MODEL` to the model id, with the key in `VENSIM_AI_API_KEY`.

The model tools do not need a key. `run_python` uses `python3` on this machine, the same way the CLI
does, and runs whatever code the caller sends.

## Register it

With `bun run dev` or `bun run mcp` already running, point the host at the printed URL:

```json
{
  "mcpServers": {
    "vensim-ai": {
      "url": "http://127.0.0.1:8787/mcp"
    }
  }
}
```

A host that only spawns a local process, and will not connect to a URL, uses stdio instead. Set
`cwd` so relative `load_mdl` / `save_mdl` paths and the `.env` search start inside this checkout:

```json
{
  "mcpServers": {
    "vensim-ai": {
      "command": "bun",
      "args": ["run", "src/main.ts"],
      "cwd": "/absolute/path/to/vensim-ai-editor/apps/mcp"
    }
  }
}
```

To pass the key only to a spawned server, put it in that block's `env` instead of a file. A
variable already set there wins over `.env`. The HTTP server reads the same `.env` when you start
it from this repository.

## Session tools

| Tool | What it does |
| --- | --- |
| `load_mdl` | Replace the session model from a `path` or from raw `.mdl` `text`. |
| `save_mdl` | Write the session model to a `.mdl` path. |
| `read_mdl` | Return the `.mdl` text without writing a file. |
| `new_model` | Replace the session with an empty model. |
| `ask_agent` | Run the built-in agent on the session model. |

`clear_model` is one of the ordinary tools. It deletes every element and keeps the model's name and
simulation settings. `new_model` resets those too.
