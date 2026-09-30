// One turn of the agent, from a prompt to a model in memory.
//
// Deliberately does no printing and writes no files: it takes a model in, hands the same model
// object to every tool call (see the getter comment below), and returns what came out. Everything
// a caller might want to change about the experience — what the progress looks like, where the
// result goes — happens on either side of this, which is what keeps those choices independent.

import { createEmptyModel, parseMdl, type Model } from "@vensim-ai/core";
import { createAgentSession, makeToolExecutor, runAgentTurn, type AgentConnection } from "@vensim-ai/agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UsageError, type Options } from "./args.js";
import { nameFromPrompt } from "./naming.js";
import { createReporter } from "./progress.js";
import { runPython } from "./python.js";

/**
 * What a session produced. Both commands end the same way — a model, how long it took, and whether
 * it finished — so both report in this shape and the ending is written once for the two of them.
 */
export interface RunResult {
  model: Model;
  /** True when the round budget ran out mid-task, so the result is a partial one. */
  stoppedEarly: boolean;
  seconds: number;
}

/** The model to start from: the one named by `--from`, or a new one titled after the prompt. */
export function startingModel(opts: Options): Model {
  // No prompt means a chat, which has nothing to title the model from yet — it is named from the
  // first turn that builds something, in chat.ts. An empty title in the meantime would put a blank
  // line where the name goes in `/model` and in the file.
  if (!opts.from) return createEmptyModel(opts.prompt.trim() ? nameFromPrompt(opts.prompt) : undefined);
  const path = resolve(opts.from);
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    throw new UsageError(`could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return parseMdl(text);
  } catch (err) {
    throw new UsageError(`${path} is not a .mdl this editor can read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Runs one turn against `model`, mutating it in place. */
export async function runPrompt(connection: AgentConnection, opts: Options, model: Model): Promise<RunResult> {
  const reporter = createReporter(opts.quiet);
  reporter.say(`Building with ${connection.model} at ${connection.baseUrl}…`);

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.on("SIGINT", onInterrupt);
  const started = Date.now();

  try {
    await runAgentTurn(
      connection,
      createAgentSession(),
      opts.prompt,
      // A getter, not the object: the tools mutate whatever this returns at the moment they run,
      // which is the same object for the whole turn here — but the agent's contract is the getter,
      // and a caller that swaps models mid-turn (as the app does, to commit each change) relies on
      // it being asked each time.
      () => model,
      reporter.callbacks,
      {
        signal: controller.signal,
        maxToolRounds: opts.rounds,
        executeToolCall: makeToolExecutor(runPython),
      },
    );
  } finally {
    process.off("SIGINT", onInterrupt);
  }

  return { model, stoppedEarly: reporter.stoppedEarly(), seconds: (Date.now() - started) / 1000 };
}
