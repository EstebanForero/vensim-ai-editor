#!/usr/bin/env bun
// Headless model generation: one prompt in and one model file out, or a conversation that ends in
// the same file.
//
// This file is the wiring, and deliberately nothing else — read the command line, resolve where
// the request is going, run it, write what came out. Each of those is a module next to this one
// (args, config, run, chat, summary, formats, output, python), so the ways to extend it are all
// the same shape: a row in a table, or a function with one job. Nothing here needs to change to
// add a provider, a flag, or an output format.
//
// The two ways to run it produce the same thing — a `RunResult` — which is why the ending below
// is written once rather than once per mode: whichever one ran, what is left to do is write the
// file, say what is in it, and pick an exit code.
//
// Everything that decides what the model *looks* like — the loop, the backends, the system prompt,
// the tools — lives in @vensim-ai/agent and is the same code the chat panel runs. A second
// implementation would be a second set of behaviours to keep in step, and the app is the one
// exercised by hand every day.

import { HELP, parseArgs, UsageError } from "./args.js";
import { runChat } from "./chat.js";
import { resolveConnection } from "./config.js";
import { loadEnvFile, mergeInto } from "./envfile.js";
import { writeModel } from "./output.js";
import { runPrompt, startingModel } from "./run.js";
import { isEmpty, summaryLines } from "./summary.js";

/** Reads the prompt from stdin when it wasn't given as an argument, which is what makes
 * `cat idea.txt | vensim-ai-generate` and `-` both work. Not reached by a chat: a session reads
 * its turns from the same stream, one line at a time, in chat.ts. */
async function promptFrom(opts: { prompt: string }): Promise<void> {
  const piped = opts.prompt === "-" || opts.prompt === "";
  if (!piped) return;
  if (process.stdin.isTTY) throw new UsageError('"-" reads the prompt from stdin, but stdin is a terminal');
  opts.prompt = (await new Response(process.stdin).text()).trim();
  if (!opts.prompt) throw new UsageError("the prompt from stdin was empty");
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  // No prompt, on a terminal, is someone sitting at the keyboard with nothing to pipe — asking to
  // be talked to rather than making a mistake to correct. A prompt still means the one-shot run,
  // which is what a script wants and what every example in the README does.
  const chatting = opts.chat || (opts.prompt === "" && Boolean(process.stdin.isTTY));
  if (!chatting) await promptFrom(opts);

  // A key left in a .env, for the same reason the flags exist: the alternative is exporting it in
  // every shell. What the environment already has wins over the file — see envfile.ts.
  const file = loadEnvFile();
  if (file.path && !opts.quiet) process.stderr.write(`Reading ${file.path}\n`);

  const { connection } = resolveConnection(opts, mergeInto(process.env, file), file.path);
  const model = startingModel(opts);
  const result = chatting ? await runChat(connection, opts, model) : await runPrompt(connection, opts, model);

  // Nothing built is a different thing in the two cases: a one-shot run that produced no model
  // failed at what it was asked to do, while a chat that ended without a model is a conversation
  // that went where it went — not an error to report to the shell.
  if (isEmpty(result.model)) {
    process.stderr.write(
      chatting ? "Nothing was built, so no file was written.\n" : "The agent finished without adding anything — nothing written.\n",
    );
    return chatting ? 0 : 1;
  }

  const path = writeModel(result.model, opts);
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
