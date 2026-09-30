import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, UsageError } from "../src/args.js";
import { resolveConnection } from "../src/config.js";
import { findEnvFile, mergeInto, parseEnvFile } from "../src/envfile.js";
import { FORMAT_NAMES, formatOf } from "../src/formats.js";
import { nameFromPrompt, slugify } from "../src/naming.js";

/**
 * The pieces the end-to-end test only reaches through a real run: argument parsing, name
 * derivation, and which credentials a given environment resolves to. Each is pure, so each is
 * cheaper to pin here than to infer from a subprocess's output.
 */

describe("parseArgs", () => {
  const parse = (args: string[]) => {
    const options = parseArgs(args);
    if (options === "help") throw new Error("parsed as help");
    return options;
  };

  test("the prompt is every positional word, joined", () => {
    expect(parse(["a", "coffee", "shop"]).prompt).toBe("a coffee shop");
  });

  test("flags take a value either way round", () => {
    expect(parse(["p", "--out", "a.mdl"]).out).toBe("a.mdl");
    expect(parse(["p", "--out=b.mdl"]).out).toBe("b.mdl");
    expect(parse(["p", "-o", "c.mdl"]).out).toBe("c.mdl");
  });

  test("defaults are filled in, and switches default off", () => {
    const options = parse(["p"]);
    expect(options.format).toBe("mdl");
    expect(options.rounds).toBe(40);
    expect(options.quiet).toBe(false);
    expect(parse(["p", "-q"]).quiet).toBe(true);
    // Chat is a flag, not a default: the same command with a prompt has to keep meaning "generate
    // this once", which is what every script and every example in the README relies on. It is the
    // *absence* of a prompt on a terminal that opens a session — see `chatting` in cli.ts.
    expect(options.chat).toBe(false);
    expect(parse(["-i"]).chat).toBe(true);
    expect(parse(["--chat"]).chat).toBe(true);
  });

  // Every one of these is a command line someone will type; the point is that each says what was
  // wrong rather than being silently ignored or parsing as something else.
  test("a bad command line is a UsageError naming the problem", () => {
    expect(() => parse(["p", "--nope"])).toThrow(UsageError);
    expect(() => parse(["p", "--format", "pdf"])).toThrow(/must be one of mdl, xmile/);
    expect(() => parse(["p", "--rounds", "many"])).toThrow(/whole number/);
    expect(() => parse(["p", "--rounds", "0"])).toThrow(/at least 1/);
    expect(() => parse(["p", "--out"])).toThrow(/needs a value/);
  });

  test("--help is recognised in its own right", () => {
    expect(parseArgs(["--help"])).toBe("help");
    expect(parseArgs(["-h"])).toBe("help");
  });
});

describe("naming", () => {
  test("a title comes from the first words of the prompt", () => {
    expect(nameFromPrompt("a model of a coffee shop queue")).toBe("A model of a coffee shop queue");
    expect(nameFromPrompt("  spaced   out  ")).toBe("Spaced out");
    expect(nameFromPrompt("what happens next?")).toBe("What happens next");
  });

  test("a long prompt is cut to something that reads as a title", () => {
    const title = nameFromPrompt("one two three four five six seven eight nine ten");
    expect(title).toBe("One two three four five six seven eight");
  });

  test("a file name is ascii, hyphenated and never empty", () => {
    expect(slugify("Tragedia de los comunes — Dos fincas")).toBe("tragedia-de-los-comunes-dos-fincas");
    expect(slugify("!!!")).toBe("model");
    expect(slugify("  A  B  ")).toBe("a-b");
  });
});

describe("formats", () => {
  test("every format is selectable by the name it advertises", () => {
    for (const name of FORMAT_NAMES) {
      const format = formatOf(name);
      expect(format.name).toBe(name);
      expect(format.extension.length).toBeGreaterThan(0);
      expect(typeof format.write).toBe("function");
    }
  });
});

describe("the .env reader", () => {
  test("reads keys and values, and skips what isn't one", () => {
    const values = parseEnvFile(
      [
        "# a comment",
        "",
        "   ",
        "DEEPSEEK_API_KEY=sk-abc123",
        "export VENSIM_AI_PROVIDER=deepseek",
        "VENSIM_AI_MODEL = deepseek-chat ",
        "not a declaration",
      ].join("\n"),
    );
    expect(values).toEqual({
      DEEPSEEK_API_KEY: "sk-abc123",
      VENSIM_AI_PROVIDER: "deepseek",
      VENSIM_AI_MODEL: "deepseek-chat",
    });
  });

  // A key is not a place to get creative, but a base URL is, and `#` and spaces are both things a
  // value can legitimately contain. Quotes mean "exactly this"; without them a comment is a comment.
  test("takes a quoted value literally and strips an unquoted trailing comment", () => {
    expect(parseEnvFile('A="a # b"\nB=\'x y\'\nC=value # why\nD=a#b')).toEqual({
      A: "a # b",
      B: "x y",
      C: "value",
      D: "a#b",
    });
  });

  test("a value may contain an equals sign", () => {
    expect(parseEnvFile("VENSIM_AI_BASE_URL=http://host/v1?x=1").VENSIM_AI_BASE_URL).toBe("http://host/v1?x=1");
  });

  test("finds the nearest file at or above where it was run, and stops at the repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "vensim-env-test-"));
    try {
      const deep = join(dir, "repo", "apps", "cli");
      mkdirSync(deep, { recursive: true });
      mkdirSync(join(dir, "repo", ".git"), { recursive: true });
      // A file beside the checkout, which is the one that must never be picked up.
      writeFileSync(join(dir, ".env"), "A=1\n");

      expect(findEnvFile(deep)).toBeNull(); // nothing inside the repository yet

      writeFileSync(join(dir, "repo", ".env"), "A=2\n");
      expect(findEnvFile(deep)).toBe(join(dir, "repo", ".env")); // the repository's own

      writeFileSync(join(dir, "repo", "apps", ".env"), "A=3\n");
      expect(findEnvFile(deep)).toBe(join(dir, "repo", "apps", ".env")); // and nearest wins
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The file is a default; the environment is a decision about this run.
  test("fills in gaps rather than overriding", () => {
    const file = { path: "/repo/.env", values: { VENSIM_AI_API_KEY: "file", VENSIM_AI_MODEL: "from-file" } };
    expect(mergeInto({ VENSIM_AI_API_KEY: "env" }, file)).toEqual({ VENSIM_AI_API_KEY: "env", VENSIM_AI_MODEL: "from-file" });
    expect(mergeInto({}, file)).toEqual({ VENSIM_AI_API_KEY: "file", VENSIM_AI_MODEL: "from-file" });
  });
});

describe("resolveConnection", () => {
  const base = { provider: null, model: null, baseUrl: null, apiKey: null } as const;
  const opts = (patch: Partial<Record<keyof typeof base, string>>) => ({ ...base, ...patch }) as never;

  test("a flag beats the environment, and the environment beats the preset", () => {
    const env = { VENSIM_AI_API_KEY: "from-env", VENSIM_AI_MODEL: "env-model" };
    const { connection } = resolveConnection(opts({ model: "from-flag" }), env);
    expect(connection.apiKey).toBe("from-env");
    expect(connection.model).toBe("from-flag");
  });

  test("the provider's own key variable works too", () => {
    expect(resolveConnection(opts({ provider: "deepseek" }), { DEEPSEEK_API_KEY: "d" }).connection.apiKey).toBe("d");
    expect(resolveConnection(opts({ provider: "gemini" }), { GEMINI_API_KEY: "g" }).connection.apiKey).toBe("g");
  });

  test("no key anywhere is a usage error naming the variable", () => {
    expect(() => resolveConnection(opts({}), {})).toThrow(/VENSIM_AI_API_KEY/);
    expect(() => resolveConnection(opts({ provider: "deepseek" }), {})).toThrow(/DEEPSEEK_API_KEY/);
  });

  test("an unknown provider lists the real ones", () => {
    expect(() => resolveConnection(opts({ provider: "nope" }), { VENSIM_AI_API_KEY: "k" })).toThrow(/Try|try one of/);
  });

  test("reasoning effort is only sent when it's one of the three words", () => {
    expect(resolveConnection(opts({}), { VENSIM_AI_API_KEY: "k", VENSIM_AI_REASONING: "high" }).connection.reasoningEffort).toBe("high");
    expect(resolveConnection(opts({}), { VENSIM_AI_API_KEY: "k", VENSIM_AI_REASONING: "lots" }).connection.reasoningEffort).toBeUndefined();
  });
});
