import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function call(index: number, name: string, args: Record<string, unknown>) {
  return { index, id: `call_${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function sse(payload: unknown): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}

const TEXT_ROUND = { choices: [{ index: 0, delta: { content: "Built it." }, finish_reason: "stop" }] };

/** The tool calls the fake endpoint asks for on the opening round of a turn. */
function openingRound(): unknown {
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

/** Every request body the endpoint received, so a test can see what the *second* turn was sent. */
let requests: string[] = [];
/** And what each one carried as its key, which is the only way to tell *which* source of a key the
 * command used when more than one of them has one. */
let keys: string[] = [];

/**
 * What to answer a turn with, keyed on what was asked. A turn starts with a user message; every
 * round after it ends with the tool results, so the last message's role is what tells the two
 * apart.
 *
 * The role, specifically: the check this replaced was "the body has no tool result in it", which is
 * true of every request once a conversation has any history at all — so a second turn looked like
 * an opening one and every multi-turn replay answered text and proved nothing.
 */
function roundFor(prompt: string): Response {
  if (prompt.includes("add a rate")) {
    return sse({
      choices: [
        {
          index: 0,
          delta: { tool_calls: [call(0, "add_auxiliary", { name: "Service rate", equation: "1", units: "1/Year" })] },
          finish_reason: "tool_calls",
        },
      ],
    });
  }
  return sse(openingRound());
}

/** The user's message, if this request starts a turn — null when it is the round that follows one. */
function turnPrompt(body: string): string | null {
  let messages: { role?: string; content?: unknown }[];
  try {
    messages = (JSON.parse(body) as { messages?: { role?: string; content?: unknown }[] }).messages ?? [];
  } catch {
    return null;
  }
  const last = messages[messages.length - 1];
  if (last?.role !== "user") return null;
  return typeof last.content === "string" ? last.content : "";
}

beforeAll(() => {
  server = Bun.serve({
    port: 4611,
    error: () => new Response("", { status: 500 }),
    async fetch(req) {
      const body = await req.text();
      requests.push(body);
      keys.push((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
      const prompt = turnPrompt(body);
      return prompt === null ? sse(TEXT_ROUND) : roundFor(prompt);
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}/v1`;
});

afterAll(() => server?.stop(true));

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "vensim-cli-test-"));
}

/**
 * Runs the CLI the way a shell does, with a scrubbed environment so a real key on this machine can
 * never leak into (or rescue) a test.
 *
 * Run in an empty directory, for the same reason and for one more: the command reads a `.env` from
 * where it is run, and the repository has one. Without this, a developer with a key in `.env` would
 * pass the tests that are about having no key at all, and some of them would go looking for a real
 * endpoint. A caller that needs to look at what the run produced passes its own directory, and then
 * gets to keep it.
 *
 * `input` is fed to stdin, which is how a chat session is driven to its end without a terminal.
 */
async function cli(args: string[], env: Record<string, string> = {}, input?: string, cwd?: string) {
  const dir = cwd ?? mkdtempSync(join(tmpdir(), "vensim-cli-cwd-"));
  try {
    const proc = Bun.spawn(["bun", "run", CLI, ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      stdout: "pipe",
      stderr: "pipe",
      stdin: input === undefined ? "ignore" : "pipe",
    });
    if (input !== undefined) {
      proc.stdin.write(input);
      await proc.stdin.end();
    }
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout, stderr, cwd: dir };
  } finally {
    if (cwd === undefined) rmSync(dir, { recursive: true, force: true });
  }
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
    // The chat is the one thing here whose default depends on something other than a flag, so the
    // help has to say so rather than leaving someone to discover it by typing the bare command.
    expect(stdout).toContain("--chat");
    expect(stdout).toContain("/model");
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
      const { code, stdout } = await cli(["a coffee shop queue", "--base-url", baseUrl, "--api-key", "test-key"], KEY, undefined, dir);
      expect(code).toBe(0);
      // No -o: the name is the prompt's, slugified, and it lands where the command was run.
      expect(stdout).toContain("a-coffee-shop-queue.mdl");
      expect(existsSync(join(dir, "a-coffee-shop-queue.mdl"))).toBe(true);
    } finally {
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

describe("a .env file", () => {
  test("provides the key, from the directory the command is run in", async () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, ".env"), "# a key I leave here\nVENSIM_AI_API_KEY=from-the-file\n");
      const out = join(dir, "from-env.mdl");
      // Nothing in the environment and no --api-key: the file is the only place a key could come
      // from, so a run that reaches the endpoint proves it was read.
      const { code, stderr } = await cli(["a population model", "-o", out, "--base-url", baseUrl], {}, undefined, dir);
      expect(code).toBe(0);
      expect(existsSync(out)).toBe(true);
      expect(keys.at(-1)).toBe("from-the-file");
      // Said out loud, once, because a config file that is silently read (or silently not) is how
      // an hour disappears into a key that was in the wrong place.
      expect(stderr).toContain(join(dir, ".env"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The rule the whole thing rests on: a file in the repository is a default, an exported key is a
  // decision about this run. Getting this backwards would mean a stale key in a file silently
  // beating the one someone just passed on the command line.
  test("is a default, not an override", async () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, ".env"), "VENSIM_AI_API_KEY=from-the-file\n");
      await cli(["a population model", "-o", join(dir, "a.mdl"), "--base-url", baseUrl], { VENSIM_AI_API_KEY: "from-the-env" }, undefined, dir);
      expect(keys.at(-1)).toBe("from-the-env");

      // And a flag beats both, which is not new — asserted here so the three orders are in one
      // place if any of them is ever changed.
      await cli(["a population model", "-o", join(dir, "b.mdl"), "--base-url", baseUrl, "--api-key", "from-the-flag"], { VENSIM_AI_API_KEY: "from-the-env" }, undefined, dir);
      expect(keys.at(-1)).toBe("from-the-flag");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is found from a subdirectory, so either entry point finds the same one", async () => {
    const dir = tmp();
    try {
      mkdirSync(join(dir, "apps", "cli"), { recursive: true });
      writeFileSync(join(dir, ".env"), "VENSIM_AI_API_KEY=from-the-file\n");
      const out = join(dir, "deep.mdl");
      // Run where `bun start` runs from, with the file at the repository root: this is the case a
      // "the .env next to you" rule would have missed.
      const { code } = await cli(["a population model", "-o", out, "--base-url", baseUrl], {}, undefined, join(dir, "apps", "cli"));
      expect(code).toBe(0);
      expect(keys.at(-1)).toBe("from-the-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is not looked for above the repository", async () => {
    const dir = tmp();
    try {
      // A `.env` above the checkout, and a repository below it with no `.env` of its own. Walking
      // up past the `.git` would find the outer one, and pick up whatever is next to a directory
      // someone happened to run from — a shared parent like /tmp, for instance.
      writeFileSync(join(dir, ".env"), "VENSIM_AI_API_KEY=not-this-one\n");
      mkdirSync(join(dir, "repo", ".git"), { recursive: true });
      const out = join(dir, "repo", "out.mdl");
      const { code, stderr } = await cli(["a population model", "-o", out, "--base-url", baseUrl], {}, undefined, join(dir, "repo"));
      expect(code).toBe(2); // no key anywhere it is willing to look
      expect(stderr).toContain("no API key");
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatting", () => {
  const chatArgs = (out: string) => ["--chat", "-o", out, "--base-url", baseUrl, "--api-key", "test-key"];

  test("keeps the conversation and the model across turns, and writes what they built at the end", async () => {
    const dir = tmp();
    const before = requests.length;
    try {
      const out = join(dir, "session.mdl");
      const checkpoint = join(dir, "checkpoint.mdl");
      // The order matters: `/save` and `/model` come *between* the two turns, which is what makes
      // them evidence of what existed mid-conversation rather than of what it ended as.
      const said = ["a queue model", `/save ${checkpoint}`, "/model", "now add a rate to it", "/exit", ""].join("\n");
      const { code, stdout } = await cli(chatArgs(out), KEY, said);

      expect(code).toBe(0);

      // The model is written on the way out, with *both* turns in it — the stock and its flow from
      // the first, the auxiliary from the second. A session that kept the conversation but not the
      // model passes every other check here and fails this one, which is the whole point of it.
      const model = parseMdl(readFileSync(out, "utf-8"));
      const names = allVariables(model).map((v) => v.name);
      expect(names).toContain("Population");
      expect(names).toContain("Service rate");

      // `/save` wrote then, not at the end: the checkpoint is what existed mid-conversation.
      const early = allVariables(parseMdl(readFileSync(checkpoint, "utf-8"))).map((v) => v.name);
      expect(early).toContain("Population");
      expect(early).not.toContain("Service rate");

      // `/model` answered from the model itself — with the model's own name on it, which a session
      // with no prompt to name it from took from the first thing said.
      expect(stdout).toContain("A queue model");
      expect(stdout).toMatch(/\d+ stocks?, \d+ flows?/);

      // And the second turn was sent the first one: one conversation, not two runs.
      const second = requests.slice(before).find((body) => body.includes("now add a rate"));
      expect(second).toBeDefined();
      expect(second).toContain("a queue model");

      // The summary the command always ends with, now naming the session's file.
      expect(stdout).toContain(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a command it doesn't have is answered here, and never reaches the model", async () => {
    const dir = tmp();
    const before = requests.length;
    try {
      const out = join(dir, "never.mdl");
      const { code, stdout, stderr } = await cli(chatArgs(out), KEY, "/help\n/nope\n/exit\n");

      expect(code).toBe(0);
      expect(stdout).toContain("/save"); // /help, from the same table dispatch reads
      expect(stdout).toContain("No such command: /nope");
      // Nothing was asked, so nothing was sent — and nothing was built, so no file was written.
      // That is not a failure to report to the shell: the session ended where the user ended it.
      expect(requests.length - before).toBe(0);
      expect(existsSync(out)).toBe(false);
      expect(stderr).toContain("Nothing was built");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a prompt on the command line is the opening message, and names the file", async () => {
    // No -o, so the path is the model's own name — the one observable place the name survives.
    // (A `.mdl` has nowhere to store it: the format has no field for a model's title, so it is
    // gone the moment the file is read back, whatever it said going out.)
    const dir = tmp();
    try {
      const { code, stdout } = await cli(["--chat", "a queue model", "--base-url", baseUrl, "--api-key", "test-key"], KEY, "/exit\n", dir);
      expect(code).toBe(0);
      // It ran before reading anything from stdin: the only line typed was the one that leaves.
      const path = join(dir, "a-queue-model.mdl");
      expect(existsSync(path)).toBe(true);
      expect(stdout).toContain(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a turn that fails does not end the session", async () => {
    // The endpoint refuses the first request, then behaves. A chat that gave up at the first error
    // would leave the user with nothing to do but start over.
    let refused = false;
    const flaky = Bun.serve({
      port: 4613,
      async fetch(req) {
        if (!refused) {
          refused = true;
          return new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), { status: 401 });
        }
        const body = await req.text();
        return turnPrompt(body) === null ? sse(TEXT_ROUND) : sse(openingRound());
      },
    });
    const dir = tmp();
    try {
      const out = join(dir, "flaky.mdl");
      const { code, stderr } = await cli(
        ["--chat", "-o", out, "--base-url", `http://127.0.0.1:${flaky.port}/v1`, "--api-key", "k"],
        {},
        "a queue model\ntry that once more\n/exit\n",
      );
      expect(code).toBe(0);
      expect(stderr).toContain("401");
      // The second attempt still went out, and what it built is in the file.
      expect(allVariables(parseMdl(readFileSync(out, "utf-8"))).map((v) => v.name)).toContain("Population");
    } finally {
      flaky.stop(true);
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
