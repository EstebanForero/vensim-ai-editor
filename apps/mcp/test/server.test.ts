import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { NEUTRAL_TOOLS } from "@vensim-ai/agent";
import { describe, expect, test } from "bun:test";
import { resolveConnection } from "../src/connection.js";
import { applyEnvFile, parseEnvFile } from "../src/env.js";
import { createServer, type AskAgent } from "../src/server.js";
import { createSession, type Session } from "../src/session.js";

async function connect(session: Session = createSession(), askAgent?: AskAgent) {
  const server = createServer({ session, askAgent });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "vensim-ai-test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

function text(result: { content: unknown; isError?: boolean }): string {
  const block = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!block || typeof block !== "object" || !("text" in block) || typeof block.text !== "string") {
    throw new Error(`expected a text result, got ${JSON.stringify(result.content)}`);
  }
  return block.text;
}

describe("MCP server", () => {
  test("advertises every agent tool plus the session tools", async () => {
    const client = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const tool of NEUTRAL_TOOLS) expect(names).toContain(tool.name);
    for (const name of ["load_mdl", "save_mdl", "read_mdl", "new_model", "ask_agent"]) expect(names).toContain(name);
    const addStock = listed.tools.find((tool) => tool.name === "add_stock");
    expect(addStock?.inputSchema).toMatchObject({ type: "object", required: ["name"] });
    await client.close();
  });

  test("edits the session model and reads it back as .mdl", async () => {
    const session = createSession("Queue");
    const client = await connect(session);

    const added = await client.callTool({ name: "add_stock", arguments: { name: "Queue", initial_equation: "0", units: "People" } });
    expect(added.isError).not.toBe(true);
    expect(JSON.parse(text(added)).name).toBe("Queue");

    const listed = JSON.parse(text(await client.callTool({ name: "list_model", arguments: {} })));
    expect(listed.stocks).toHaveLength(1);

    const mdl = text(await client.callTool({ name: "read_mdl", arguments: {} }));
    expect(mdl).toContain("Queue");

    const dir = await mkdtemp(join(tmpdir(), "vensim-mcp-"));
    const path = join(dir, "queue.mdl");
    const saved = JSON.parse(text(await client.callTool({ name: "save_mdl", arguments: { path } })));
    expect(saved.path).toBe(path);
    expect(await readFile(path, "utf8")).toContain("Queue");

    const cleared = JSON.parse(text(await client.callTool({ name: "new_model", arguments: { name: "Empty" } })));
    expect(cleared.name).toBe("Empty");
    expect(session.model.stocks).toHaveLength(0);

    const loaded = JSON.parse(text(await client.callTool({ name: "load_mdl", arguments: { text: mdl } })));
    expect(loaded.stocks).toBe(1);
    expect(session.model.stocks[0]?.name).toBe("Queue");
    await client.close();
  });

  test("rejects a stock with no name before touching the model", async () => {
    const session = createSession();
    const client = await connect(session);
    const rejected = await client.callTool({ name: "add_stock", arguments: {} });
    expect(rejected.isError).toBe(true);
    expect(text(rejected)).toContain("name");
    expect(session.model.stocks).toHaveLength(0);
    await client.close();
  });

  test("stores a lookup curve", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "set_lookup",
      arguments: { name: "Effect", points: [[0, 0], [1, 1]], units: "Dmnl" },
    });
    expect(result.isError).not.toBe(true);
    const listed = JSON.parse(text(await client.callTool({ name: "list_model", arguments: {} })));
    expect(listed.auxiliaries[0].lookup.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    await client.close();
  });

  test("ask_agent continues one conversation until fresh", async () => {
    const session = createSession();
    const seen: unknown[][] = [];
    const client = await connect(session, async (current, prompt) => {
      seen.push([prompt, current.agent.history.length]);
      current.agent.history.push(prompt);
      return { assistant: `did: ${prompt}`, stoppedEarly: false, aborted: false, tools: [{ name: "add_stock", ok: true }] };
    });

    const first = JSON.parse(text(await client.callTool({ name: "ask_agent", arguments: { prompt: "a queue" } })));
    expect(first.assistant).toBe("did: a queue");
    expect(first.tools).toEqual([{ name: "add_stock", ok: true }]);

    await client.callTool({ name: "ask_agent", arguments: { prompt: "add a delay", fresh: true } });
    expect(seen).toEqual([
      ["a queue", 0],
      ["add a delay", 0],
    ]);
    await client.close();
  });

  test("ask_agent reports a missing key without calling a provider", async () => {
    const previous = process.env.VENSIM_AI_API_KEY;
    const openai = process.env.OPENAI_API_KEY;
    const deepseek = process.env.DEEPSEEK_API_KEY;
    const gemini = process.env.GEMINI_API_KEY;
    const openrouter = process.env.OPENROUTER_API_KEY;
    const provider = process.env.VENSIM_AI_PROVIDER;
    delete process.env.VENSIM_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.VENSIM_AI_PROVIDER = "openai";
    try {
      const client = await connect();
      const result = await client.callTool({ name: "ask_agent", arguments: { prompt: "anything" } });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("VENSIM_AI_API_KEY");
      await client.close();
    } finally {
      if (previous === undefined) delete process.env.VENSIM_AI_API_KEY;
      else process.env.VENSIM_AI_API_KEY = previous;
      if (openai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = openai;
      if (deepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = deepseek;
      if (gemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = gemini;
      if (openrouter === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = openrouter;
      if (provider === undefined) delete process.env.VENSIM_AI_PROVIDER;
      else process.env.VENSIM_AI_PROVIDER = provider;
    }
  });
});

test("the stdio process answers initialize and edits the model", async () => {
  const proc = spawn("bun", ["run", "src/main.ts"], {
    cwd: join(import.meta.dir, ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const pending = new Map<number, (line: string) => void>();
  let buf = "";
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { id?: number };
      if (typeof msg.id === "number") pending.get(msg.id)?.(line);
    }
  });
  function request(id: number, method: string, params: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}. stderr: ${stderr}`)), 8000);
      pending.set(id, (line) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(line);
      });
      proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  try {
    const init = JSON.parse(
      await request(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      }),
    ) as { result?: { serverInfo?: { name?: string } }; error?: unknown };
    expect(init.error).toBeUndefined();
    expect(init.result?.serverInfo?.name).toBe("vensim-ai");
    proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const added = JSON.parse(
      await request(2, "tools/call", { name: "add_stock", arguments: { name: "People", initial_equation: "3" } }),
    ) as { result?: { isError?: boolean; content?: { text?: string }[] } };
    expect(added.result?.isError).not.toBe(true);
    expect(added.result?.content?.[0]?.text).toContain("People");
    // The protocol channel is stdout. A startup line on it would already have made JSON.parse throw.
    expect(stderr).toContain("listening on stdio");
  } finally {
    proc.kill();
  }
});

describe("connection", () => {
  test("uses the provider key and preset when Vensim-specific variables are unset", () => {
    const connection = resolveConnection({ OPENAI_API_KEY: "sk-test" });
    expect(connection.apiKey).toBe("sk-test");
    expect(connection.baseUrl).toBe("https://api.openai.com/v1");
    expect(connection.model).toBe("gpt-4o");
  });

  test("prefers VENSIM_AI_API_KEY and an explicit endpoint", () => {
    const connection = resolveConnection({
      VENSIM_AI_PROVIDER: "custom",
      VENSIM_AI_BASE_URL: "https://api.x.ai/v1",
      VENSIM_AI_MODEL: "grok-4",
      VENSIM_AI_API_KEY: "xai-test",
      OPENAI_API_KEY: "should-not-win",
      VENSIM_AI_REASONING: "low",
    });
    expect(connection).toEqual({
      apiKey: "xai-test",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4",
      reasoningEffort: "low",
    });
  });
});

describe("env file", () => {
  test("parses quotes and does not override an existing variable", () => {
    expect(parseEnvFile('export VENSIM_AI_API_KEY="a b"\n# comment\nOPENAI_API_KEY=sk\n')).toEqual({
      VENSIM_AI_API_KEY: "a b",
      OPENAI_API_KEY: "sk",
    });
    const root = mkdtempSync(join(tmpdir(), "vensim-env-"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=from-file\nVENSIM_AI_MODEL=from-file\n");
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "already" };
    expect(applyEnvFile(env, root)).toBe(join(root, ".env"));
    expect(env.OPENAI_API_KEY).toBe("already");
    expect(env.VENSIM_AI_MODEL).toBe("from-file");
  });
});
