// The command line itself: what a flag is, what the options are once parsed, and the help text.
//
// One table declares every flag, and parsing, validation and `--help` all read from it. Adding a
// flag is adding a row; the three places that would otherwise each need editing — the parser, the
// type, the usage text — can't drift apart because there is only one of them.

import { PROVIDER_PRESETS } from "@vensim-ai/agent";
import { FORMAT_NAMES, formatOf, type FormatName } from "./formats.js";

/** What the command was asked to do. `prompt` is filled in by the parser from the positional
 * arguments; everything else comes from a flag. */
export interface Options {
  prompt: string;
  out: string | null;
  format: FormatName;
  from: string | null;
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  rounds: number;
  quiet: boolean;
  chat: boolean;
}

/** A bad command line — as opposed to a failed run. Reported with the usage text and exit code 2,
 * so a script can tell "you asked for something impossible" from "the provider said no". */
export class UsageError extends Error {}

interface Flag {
  /** The property on `Options` this sets. */
  key: keyof Options;
  /** Every spelling that selects it. The first is the one shown in `--help`. */
  names: string[];
  /** Placeholder for a value-taking flag, as shown in help. Absent means it's a switch. */
  arg?: string;
  help: string;
  /** Turns the raw string into the value. Absent means "the raw string". */
  parse?: (raw: string) => unknown;
}

function oneOf<T extends string>(allowed: readonly T[], what: string) {
  return (raw: string): T => {
    if (!(allowed as readonly string[]).includes(raw)) throw new UsageError(`${what} must be one of ${allowed.join(", ")} — got "${raw}"`);
    return raw as T;
  };
}

function wholeNumberAtLeast(min: number) {
  return (raw: string): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) throw new UsageError(`expected a whole number of at least ${min}, got "${raw}"`);
    return value;
  };
}

export const FLAGS: Flag[] = [
  { key: "out", names: ["-o", "--out"], arg: "<path>", help: "Where to write it. Default: the model's own name, slugified." },
  { key: "format", names: ["--format"], arg: "<fmt>", help: `Output format — see below. Default: ${FORMAT_NAMES[0]}`, parse: oneOf(FORMAT_NAMES, "--format") },
  { key: "from", names: ["-f", "--from"], arg: "<path>", help: "Revise an existing .mdl instead of starting empty" },
  { key: "provider", names: ["--provider"], arg: "<name>", help: PROVIDER_PRESETS.map((p) => p.name).join(", ") },
  { key: "model", names: ["--model"], arg: "<id>", help: "Model id. Default: the provider preset's" },
  { key: "baseUrl", names: ["--base-url"], arg: "<url>", help: "Endpoint. Default: the provider preset's" },
  { key: "apiKey", names: ["--api-key"], arg: "<key>", help: "Default: $VENSIM_AI_API_KEY, or the provider's own variable" },
  { key: "rounds", names: ["--rounds"], arg: "<n>", help: "Tool-call rounds to allow before stopping. Default: 40", parse: wholeNumberAtLeast(1) },
  { key: "quiet", names: ["-q", "--quiet"], help: "No progress lines, just the result" },
  // Listed last because it changes what the command *is* rather than how it behaves, and it is the
  // one flag here whose default depends on something other than a flag — see the note in HELP and
  // the `chatting` decision in cli.ts.
  { key: "chat", names: ["-i", "--chat"], help: "Talk to the agent instead of prompting it once — see below" },
];

const HELP_FLAGS = ["-h", "--help"];

const DEFAULT_ROUNDS = 40;

export const HELP = `Generate a system-dynamics model from a description, or talk to the agent about one.

  bun run generate <prompt> [options]        one prompt in, one model file out
  bun run generate [options]                 no prompt, on a terminal: a chat, as many turns as you like
  bun start <prompt> [options]               from apps/cli

The package declares a \`vensim-ai-generate\` bin, but nothing links it — this is a private
package inside a workspace, so it is not on your PATH. Use one of the two above.

  ${"<prompt>".padEnd(20)}What to build. "-" reads it from stdin.
${FLAGS.map((f) => `  ${(f.names.join(", ") + (f.arg ? ` ${f.arg}` : "")).padEnd(20)}${f.help}`).join("\n")}
  ${"-h, --help".padEnd(20)}Show this

Chat: with no prompt and a terminal to type on, the command opens a session instead of running
once — one model, one conversation, as many turns as you like. It is the same agent with the same
tools; what it keeps between turns is the conversation and the model, so "now add a delay to that"
refers to what was just built. Flags still apply: -o sets where the file goes, --from starts from
an existing model, -q silences the tool lines. In the session, /model describes what is on the
canvas, /save writes the file early, /help lists the rest, and the file is written on the way out.

Formats:
${FORMAT_NAMES.map((name) => `  ${name.padEnd(20)}${formatOf(name).note ?? ""}`).join("\n")}

Environment: VENSIM_AI_API_KEY (or OPENAI_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY /
OPENROUTER_API_KEY), plus VENSIM_AI_PROVIDER, VENSIM_AI_MODEL and VENSIM_AI_BASE_URL to save
passing the flags. The key is never written anywhere.

Note: the agent's run_python tool executes code on this machine, as you.
`;

const BY_NAME = new Map<string, Flag>(FLAGS.flatMap((f) => f.names.map((n) => [n, f] as const)));

export function parseArgs(argv: string[]): Options | "help" {
  const options: Options = {
    prompt: "",
    out: null,
    format: "mdl" as FormatName,
    from: null,
    provider: null,
    model: null,
    baseUrl: null,
    apiKey: null,
    rounds: DEFAULT_ROUNDS,
    quiet: false,
    chat: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (HELP_FLAGS.includes(arg)) return "help";

    // `--flag=value` and `--flag value` both: which one gets typed depends on habit, and refusing
    // one of them is a worse experience than parsing both.
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const flag = BY_NAME.get(name);
    if (!flag) {
      if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option "${arg}"`);
      positional.push(arg);
      continue;
    }

    let raw: string | null = inline;
    if (flag.arg !== undefined && raw === null) {
      raw = argv[++i] ?? null;
      if (raw === null) throw new UsageError(`${name} needs a value`);
    }
    const value = flag.arg === undefined ? true : (flag.parse?.(raw!) ?? raw);
    // The table is the single declaration point, so the assignment is by name rather than by
    // type; each flag's `parse` is what guarantees the value fits the field it lands in, and a
    // mistyped table entry is caught by the Options interface at the top of this file.
    (options as unknown as Record<string, unknown>)[flag.key] = value;
  }

  // Every bare word is part of the prompt, so an unquoted sentence works — `generate make me a
  // model of a coffee shop` is how someone actually types this, and demanding quotes around the
  // obvious thing is a rule that exists only for the parser's convenience.
  options.prompt = positional.join(" ").trim();
  return options;
}
