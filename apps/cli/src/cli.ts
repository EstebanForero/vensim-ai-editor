#!/usr/bin/env bun
// Headless model generation: one prompt in, one model file out.
//
// This file is the wiring, and deliberately nothing else — read the command line, resolve where
// the request is going, run a turn, write what came out. Each of those is a module next to this
// one (args, config, run, summary, formats, python), so the ways to extend it are all the same
// shape: a row in a table, or a function with one job. Nothing here needs to change to add a
// provider, a flag, or an output format.
//
// Everything that decides what the model *looks* like — the loop, the backends, the system prompt,
// the tools — lives in @vensim-ai/agent and is the same code the chat panel runs. A second
// implementation would be a second set of behaviours to keep in step, and the app is the one
// exercised by hand every day.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HELP, parseArgs, UsageError } from "./args.js";
import { resolveConnection } from "./config.js";
import { formatOf } from "./formats.js";
import { slugify } from "./naming.js";
import { runPrompt, startingModel } from "./run.js";
import { isEmpty, summaryLines } from "./summary.js";

/** Reads the prompt from stdin when it wasn't given as an argument, which is what makes
 * `cat idea.txt | vensim-ai-generate` and `-` both work. */
async function promptFrom(opts: { prompt: string }): Promise<void> {
  const piped = opts.prompt === "-" || opts.prompt === "";
  if (!piped) return;
  if (process.stdin.isTTY) {
    if (opts.prompt === "") throw new UsageError("no prompt: pass one as an argument, or pipe it in");
    throw new UsageError('"-" reads the prompt from stdin, but stdin is a terminal');
  }
  opts.prompt = (await new Response(process.stdin).text()).trim();
  if (!opts.prompt) throw new UsageError("the prompt from stdin was empty");
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  await promptFrom(opts);

  const { connection } = resolveConnection(opts);
  const model = startingModel(opts);
  const result = await runPrompt(connection, opts, model);

  if (isEmpty(result.model)) {
    process.stderr.write("The agent finished without adding anything — nothing written.\n");
    return 1;
  }

  const format = formatOf(opts.format);
  const path = resolve(opts.out ?? `${slugify(result.model.name)}.${format.extension}`);
  writeFileSync(path, format.write(result.model));

  process.stdout.write(summaryLines({ path, model: result.model, seconds: result.seconds, stoppedEarly: result.stoppedEarly }).join("\n") + "\n");
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`${err.message}\n\n${HELP}`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
