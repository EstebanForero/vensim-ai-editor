import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addFlow, addStock, allVariables, createEmptyModel, parseMdl } from "@vensim-ai/core";
import { runPython } from "../src/python.js";

/**
 * The CLI is driven as a real subprocess against a real OpenAI-compatible SSE endpoint, rather
 * than by calling its parts. What could go wrong here lives exactly in the seams a subprocess
 * exercises and an in-process test skips: whether `bun run` passes the prompt through, whether an
 * exit code reaches the shell, whether the file lands where it says it does.
 */

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

/** The tool calls the fake endpoint asks for on the opening round, then it replies with text. */
function openingRound(): unknown {
  const call = (index: number, name: string, args: Record<string, unknown>) => ({
    index,
    id: `call_${index}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
  return {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            call(0, "add_stock", { name: "Population", initial_equation: "100", units: "People" }),
            call(1, "add_flow", { name: "Births", equation: "Population * Birth rate", to: "Population", units: "People/Year" }),
            call(2, "add_constant", { name: "Birth rate", value: 0.05, units: "1/Year" }),
            call(3, "add_relation", { from: "Population", to: "Births" }),
            call(4, "add_stock", { name: "Spare", initial_equation: "0", units: "People" }),
            call(5, "add_stock", { name: "Spare", initial_equation: "0", units: "People" }),
            // Exercises the CLI's own interpreter, not just the model tools.
            call(6, "run_python", { code: "print('checked', len(model))" }),
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

beforeAll(() => {
  server = Bun.serve({
    port: 4611,
    error: () => new Response("", { status: 500 }),
    async fetch(req) {
      const body = await req.text();
      // A tool result in the request means the tools already ran — answer with text so the turn
      // ends, and answer the opening round with the tool calls.
      const opening = !/"role"\s*:\s*"tool"/.test(body);
      const payload = opening ? openingRound() : { choices: [{ index: 0, delta: { content: "Built it." }, finish_reason: "stop" }] };
      return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}/v1`;
});

afterAll(() => server?.stop(true));

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "vensim-cli-test-"));
}

/** Runs the CLI the way a shell does, with a scrubbed environment so a real key on this machine
 * can never leak into (or rescue) a test. */
async function cli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

const KEY = { VENSIM_AI_API_KEY: "test-key" };

describe("usage, before any network call", () => {
  test("--help explains itself and exits clean", async () => {
    const { code, stdout } = await cli(["--help"]);
    expect(code).toBe(0);
    // The usage line names the commands you can actually run. It used to say
    // `vensim-ai-generate`, which is the package's declared bin and is not on anyone's PATH —
    // a private workspace package's bin is not linked — so the help advertised a command that
    // only produced "command not found".
    expect(stdout).toContain("bun run generate <prompt>");
    expect(stdout).toContain("bun start <prompt>");
    expect(stdout).toContain("--provider");
  });

  test("no API key is a usage error, named by the variable to set", async () => {
    const { code, stderr } = await cli(["build something"]);
    expect(code).toBe(2);
    expect(stderr).toContain("VENSIM_AI_API_KEY");
  });

  test("an unknown provider lists the ones that exist", async () => {
    const { code, stderr } = await cli(["build something"], { ...KEY, VENSIM_AI_PROVIDER: "nope" });
    expect(code).toBe(2);
    expect(stderr).toContain("unknown provider");
    expect(stderr).toContain("DeepSeek");
  });

  test("an unknown flag is rejected rather than silently ignored", async () => {
    const { code, stderr } = await cli(["build something", "--wat"], KEY);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown option "--wat"');
  });
});

describe("generating a model", () => {
  test("writes the file it names, and the file is a real model", async () => {
    const dir = tmp();
    try {
      const out = join(dir, "population.mdl");
      const { code, stdout, stderr } = await cli(["a population model", "-o", out, "--base-url", baseUrl, "--api-key", "test-key"]);

      expect(stderr).toContain("✓ add_stock");
      // The duplicate-name call fails at the tool level and the run carries on — a rejected tool
      // call is a normal thing for an agent to hit, not a reason to abandon the file.
      expect(stderr).toContain("✗ add_stock");
      expect(stderr).toContain("Built it."); // the agent's own summary is progress, not output
      expect(code).toBe(0);

      expect(existsSync(out)).toBe(true);
      const model = parseMdl(readFileSync(out, "utf-8"));
      expect(allVariables(model).map((v) => v.name).sort()).toEqual(["Birth rate", "Births", "Population", "Spare"]);
      // The summary is what makes the file judgeable without opening it.
      expect(stdout).toContain("2 stocks, 1 flow, 1 auxiliary, 1 relation");
      expect(stdout).toContain("1 feedback loop (R1)");
      // One reinforcing loop on its own is not an archetype, and the summary says so by leaving
      // the line out rather than by printing an empty one.
      expect(stdout).not.toContain("archetypes:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a prompt reaches the model, and the default file name comes from it", async () => {
    const dir = tmp();
    try {
      const { code, stdout } = await cli(["a coffee shop queue", "--base-url", baseUrl, "--api-key", "test-key"], { ...KEY, VENSIM_AI_HOME: dir });
      expect(code).toBe(0);
      // No -o: the name is the prompt's, slugified.
      expect(stdout).toContain("a-coffee-shop-queue.mdl");
      expect(existsSync(join(process.cwd(), "a-coffee-shop-queue.mdl"))).toBe(true);
    } finally {
      rmSync(join(process.cwd(), "a-coffee-shop-queue.mdl"), { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--quiet leaves only the result on stdout", async () => {
    const dir = tmp();
    try {
      const out = join(dir, "quiet.mdl");
      const { stdout, stderr } = await cli(["a population model", "-o", out, "--base-url", baseUrl, "--api-key", "test-key", "-q"]);
      expect(stderr).toBe("");
      expect(stdout).not.toContain("✓");
      expect(stdout).toContain(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a provider that refuses the request fails loudly instead of writing an empty file", async () => {
    // A wrong or missing key, which is the failure anyone actually hits. Answered with the
    // provider's own error body so the message that reaches the user is the provider's.
    const refusing = Bun.serve({
      port: 4612,
      fetch: () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), { status: 401 }),
    });
    const dir = tmp();
    try {
      const out = join(dir, "never.mdl");
      const { code, stderr } = await cli(["anything", "-o", out, "--base-url", `http://127.0.0.1:${refusing.port}/v1`, "--api-key", "bad"]);
      expect(code).toBe(1);
      expect(stderr).toContain("401");
      expect(existsSync(out)).toBe(false);
    } finally {
      refusing.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("run_python", () => {
  /** One stock and one flow — enough for `sim` and `model` to have something in them. */
  function tinyModel() {
    const model = createEmptyModel("Tiny");
    addStock(model, { name: "Population", initialEquation: "100" });
    addFlow(model, { name: "Births", equation: "Population * 0.05", to: "Population" });
    return model;
  }

  test("runs the model's code and returns what it printed", async () => {
    const result = await runPython("print('vars', len(model))\nprint('steps', len(sim['time']))", tinyModel());
    expect(result.ok).toBe(true);
    expect(String(result.result && (result.result as { stdout: string }).stdout)).toContain("vars 2");
  });

  test("a failing check comes back as the traceback, not as a thrown error", async () => {
    const result = await runPython("print('before the failure')\nraise ValueError('nope')", tinyModel());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("nope");
    expect(result.error).toContain("before the failure");
  });
});
