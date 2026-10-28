// The MCP server. Other agents call the same tools the in-app agent calls (`add_stock`,
// `run_simulation`, …) against one in-memory model, or hand that model to this project's own
// agent with `ask_agent` and let it do the editing.
//
// Stdout belongs to the protocol. Nothing in this module writes to it.

import { readFile, writeFile } from "node:fs/promises";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import {
  NEUTRAL_TOOLS,
  MUTATING_TOOL_NAMES,
  createAgentSession,
  makeToolExecutor,
  runAgentTurn,
  type PythonRunner,
  type ToolCallResult,
} from "@vensim-ai/agent";
import { executeTool } from "@vensim-ai/ai-tools";
import { createEmptyModel, parseMdl, writeMdl } from "@vensim-ai/core";
import * as z from "zod/v4";
import { ConnectionError, resolveConnection } from "./connection.js";
import { runPython as defaultRunPython } from "./python.js";
import { inputObject } from "./schema.js";
import { createSession, type Session } from "./session.js";

const SERVER_VERSION = "0.1.0";

export interface AgentTurnReport {
  assistant: string;
  stoppedEarly: boolean;
  aborted: boolean;
  tools: { name: string; ok: boolean; error?: string }[];
}

/** Runs one turn of the built-in agent. Tests pass their own so a suite never calls a provider. */
export type AskAgent = (session: Session, prompt: string, maxToolRounds: number, signal: AbortSignal) => Promise<AgentTurnReport>;

export interface CreateServerOptions {
  session?: Session;
  askAgent?: AskAgent;
  runPython?: PythonRunner;
  /** Shared by every server instance that edits one session. HTTP builds a fresh instance per
   * request, so the lock has to live outside any one of them. */
  lock?: Lock;
}

export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

function textResult(payload: unknown): CallToolResult {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function fromTool(result: ToolCallResult): CallToolResult {
  if (!result.ok) return errorResult(result.error ?? "The tool failed.");
  return textResult(result.result ?? { ok: true });
}

/** One turn of the editor's agent, against `session.model`, continuing `session.agent` unless the caller replaced it. */
export async function askWithConnection(session: Session, prompt: string, maxToolRounds: number, signal: AbortSignal, runPython: PythonRunner): Promise<AgentTurnReport> {
  const connection = resolveConnection();
  const tools: AgentTurnReport["tools"] = [];
  const parts: string[] = [];
  let stoppedEarly = false;
  let aborted = false;
  await runAgentTurn(
    connection,
    session.agent,
    prompt,
    () => session.model,
    {
      onAssistantText: (text) => {
        if (text) parts.push(text);
      },
      onToolCall: (name, _input, result) => {
        tools.push(result.error ? { name, ok: result.ok, error: result.error } : { name, ok: result.ok });
      },
      onStoppedEarly: () => {
        stoppedEarly = true;
      },
      onAborted: () => {
        aborted = true;
      },
    },
    { maxToolRounds, signal, executeToolCall: makeToolExecutor(runPython) },
  );
  return { assistant: parts.join("\n"), stoppedEarly, aborted, tools };
}

export function createLock(): Lock {
  let tail: Promise<void> = Promise.resolve();
  return function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/**
 * A server bound to `session`. The same session can back every instance a stdio host builds for
 * one process (including the short-lived one used to negotiate the protocol), so a model loaded
 * on the connection the client keeps is the model later calls edit.
 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const session = options.session ?? createSession();
  const runPython = options.runPython ?? defaultRunPython;
  const askAgent = options.askAgent ?? ((current, prompt, maxToolRounds, signal) => askWithConnection(current, prompt, maxToolRounds, signal, runPython));
  const exclusive = options.lock ?? createLock();

  const server = new McpServer({
    name: "vensim-ai",
    version: SERVER_VERSION,
    title: "Vensim AI Editor",
    description:
      "Edits one Vensim system-dynamics model in memory. Call the model tools directly, or ask_agent to have this project's own agent build and revise the model. Nothing is written to disk until save_mdl.",
  });

  for (const tool of NEUTRAL_TOOLS) {
    const readOnly = !MUTATING_TOOL_NAMES.has(tool.name);
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: inputObject(tool.parameters),
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: tool.name === "clear_model" || tool.name === "delete_element",
          openWorldHint: tool.name === "run_python",
        },
      },
      async (args) =>
        exclusive(async () => {
          if (tool.name === "run_python") {
            const code = typeof args.code === "string" ? args.code : "";
            return fromTool(await runPython(code, session.model));
          }
          return fromTool(executeTool(session.model, tool.name, args));
        }),
    );
  }

  server.registerTool(
    "load_mdl",
    {
      description:
        "Replace the session model with a Vensim .mdl file. Pass `path` to read a file, or `text` to pass the file contents. This does not continue the previous diagram — the loaded model is the whole session. The agent's conversation is left as it was; pass fresh:true on the next ask_agent if that conversation was about a different model.",
      inputSchema: z.object({
        path: z.string().optional().describe("Absolute or process-relative path of a .mdl file."),
        text: z.string().optional().describe(".mdl source. Used when path is omitted."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) =>
      exclusive(async () => {
        if (args.path && args.text) return errorResult("Pass path or text, not both.");
        if (!args.path && !args.text) return errorResult("Pass path or text.");
        try {
          const text = args.text ?? (await readFile(args.path!, "utf8"));
          session.model = parseMdl(text);
          return textResult({ name: session.model.name, stocks: session.model.stocks.length, flows: session.model.flows.length, auxiliaries: session.model.auxiliaries.length });
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "save_mdl",
    {
      description: "Write the session model to a .mdl file. The path is resolved from this process's working directory unless it is absolute. The in-memory model is kept.",
      inputSchema: z.object({
        path: z.string().describe("Where to write the .mdl file."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      exclusive(async () => {
        try {
          const text = writeMdl(session.model);
          await writeFile(args.path, text, "utf8");
          return textResult({ path: args.path, bytes: Buffer.byteLength(text) });
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      }),
  );

  server.registerTool(
    "read_mdl",
    {
      description: "Return the session model as Vensim .mdl text, without writing a file.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => exclusive(async () => textResult(writeMdl(session.model))),
  );

  server.registerTool(
    "new_model",
    {
      description: "Replace the session model with an empty one. Simulation settings return to the defaults, unlike clear_model, which keeps the model's name and simulation settings.",
      inputSchema: z.object({
        name: z.string().optional().describe("Name of the new model. Defaults to \"New Model\"."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) =>
      exclusive(async () => {
        session.model = createEmptyModel(args.name ?? "New Model");
        return textResult({ name: session.model.name });
      }),
  );

  server.registerTool(
    "ask_agent",
    {
      description:
        "Give a task to this project's own model-building agent. It edits the session model with the same tools listed here (add_stock, set_equation, run_simulation, run_python, and the rest) and replies with what it did. Calls continue one conversation until `fresh` is true. Requires the API key and provider this server was launched with (VENSIM_AI_API_KEY, or the provider's own key, plus VENSIM_AI_PROVIDER / VENSIM_AI_BASE_URL / VENSIM_AI_MODEL) — the same variables as `bun run generate`.",
      inputSchema: z.object({
        prompt: z.string().describe("What to build or change."),
        max_tool_rounds: z.number().int().min(1).max(80).optional().describe("How many model responses the turn may take. Default 40."),
        fresh: z.boolean().optional().describe("Start a new conversation instead of continuing the previous one."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args, ctx) =>
      exclusive(async () => {
        if (args.fresh) session.agent = createAgentSession();
        try {
          const report = await askAgent(session, args.prompt, args.max_tool_rounds ?? 40, ctx.mcpReq.signal);
          return textResult(report);
        } catch (err) {
          const message = err instanceof ConnectionError || err instanceof Error ? err.message : String(err);
          return errorResult(message);
        }
      }),
  );

  return server;
}
