// Chat: the same agent, several turns deep, in a terminal.
//
// What makes this a conversation rather than several runs is only what it keeps between turns —
// one `AgentSession` for what was said, and one `Model` object for what was built. Both are
// exactly what the one-shot path discards when its single turn ends. So this is not a second kind
// of run: it is the same run, asked again, with its work still in front of it. The agent cannot
// tell the difference, which is the point — everything that decides how a model is built (the
// loop, the brief, the tools) is the code the app's chat panel runs, unmodified.
//
// What lives *here* is the terminal's half: reading lines, deciding that `/save` is a command
// rather than something to ask the model, and being interruptible mid-turn. The commands are a
// table for the reason the flags are one — `/help` reads it, dispatch reads it, and adding one is
// a row.

import { createInterface } from "node:readline";
import { createAgentSession, makeToolExecutor, runAgentTurn, type AgentConnection } from "@vensim-ai/agent";
import type { Model } from "@vensim-ai/core";
import type { Options } from "./args.js";
import { nameFromPrompt } from "./naming.js";
import { writeModel } from "./output.js";
import { createChatReporter, describeError } from "./progress.js";
import { runPython } from "./python.js";
import { isEmpty, modelLines } from "./summary.js";
import type { RunResult } from "./run.js";

/** Lines from stdin, one at a time, whether that is a terminal or a pipe. */
interface Lines {
  /** Draws the prompt, and says whether it drew one — on a terminal only, since in a pipe it would
   * land in the middle of whatever is reading the output. What is drawn next has to move to its
   * own line when it did, which is what the caller passes this answer on for. */
  prompt(): boolean;
  /** The next line, or null at the end of input (Ctrl-D, or the pipe closing). */
  next(): Promise<string | null>;
  close(): void;
}

/**
 * `readline`'s own `question()` would do for a terminal, but it never resolves when a pipe ends —
 * and a chat fed by `printf` has to finish rather than hang — so lines are queued here instead.
 */
function openLines(onInterrupt: () => void): Lines {
  const rl = createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY) });
  const queued: string[] = [];
  let ended = false;
  let wake: (() => void) | null = null;

  rl.on("line", (line) => {
    queued.push(line);
    wake?.();
  });
  rl.on("close", () => {
    ended = true;
    wake?.();
  });
  // On a terminal, Ctrl-C is a byte that readline turns into this event and never into a signal;
  // in a pipe it is a real signal. Listening for both would risk one keypress stopping the turn
  // *and* ending the session, so it is one or the other.
  if (process.stdin.isTTY) rl.on("SIGINT", onInterrupt);
  else process.on("SIGINT", onInterrupt);

  return {
    prompt: () => {
      if (!process.stdin.isTTY) return false;
      process.stdout.write("\n> ");
      return true;
    },
    async next() {
      while (!queued.length && !ended) await new Promise<void>((resolve) => (wake = resolve));
      wake = null;
      return queued.shift() ?? null;
    },
    close: () => {
      rl.close();
      // Without this the process stays alive at the end of the session: readline resumed stdin,
      // and a resumed stream is something for the event loop to wait on.
      process.stdin.pause();
    },
  };
}

/** What a command may do: read the model, write it, say something, or end the session. */
interface CommandContext {
  model: Model;
  opts: Options;
  /** Output the user asked for, which goes to stdout — unlike progress, which is stderr. */
  out(line: string): void;
}

export interface ChatCommand {
  /** Every spelling that runs it. The first is the one `/help` shows. */
  names: string[];
  arg?: string;
  help: string;
  run(ctx: CommandContext, arg: string): "exit" | void;
}

export const COMMANDS: ChatCommand[] = [
  {
    names: ["/model"],
    help: "What is on the canvas: elements, loops, archetypes.",
    run: (ctx) => {
      ctx.out(ctx.model.name || "(untitled)");
      for (const line of modelLines(ctx.model)) ctx.out(line);
    },
  },
  {
    names: ["/save"],
    arg: "[path]",
    help: "Write the model to a file now, without ending the session.",
    run: (ctx, arg) => ctx.out(writeModel(ctx.model, ctx.opts, arg || undefined)),
  },
  {
    names: ["/exit", "/quit"],
    help: "Leave. The file is written on the way out, the same as a one-shot run.",
    run: () => "exit",
  },
  {
    names: ["/help"],
    help: "This.",
    run: (ctx) => ctx.out(COMMAND_HELP),
  },
];

/** Built from the table, so the list cannot describe commands that aren't there. */
export const COMMAND_HELP = [
  "",
  ...COMMANDS.map((c) => `  ${(c.names.join(", ") + (c.arg ? ` ${c.arg}` : "")).padEnd(13)}${c.help}`),
  "",
  "  Anything else is a message to the agent. Ctrl-C stops the current turn; at the prompt it",
  "  leaves, and the model is written out either way.",
  "",
].join("\n");

/**
 * Runs a session against `model`, mutating it in place, and returns in the same shape a one-shot
 * run does — so the command's ending (write the file, print the summary, choose an exit code) is
 * written once for both.
 */
export async function runChat(connection: AgentConnection, opts: Options, model: Model): Promise<RunResult> {
  const reporter = createChatReporter(opts.quiet);
  const session = createAgentSession();
  const started = Date.now();
  const out = (line: string) => process.stdout.write(line + "\n");
  let controller: AbortController | null = null;

  // Ctrl-C means two different things depending on when it lands, and both are the obvious one:
  // while the agent is working it stops the agent — the conversation and the model survive it, as
  // they do behind the app's Stop button — and at the prompt it leaves.
  const lines = openLines(() => {
    if (controller) controller.abort();
    else lines.close();
  });

  reporter.say(`Chatting with ${connection.model} at ${connection.baseUrl}. /help for commands, /exit to leave.`);
  reporter.say(isEmpty(model) ? "Nothing on the canvas yet — say what to build." : `Starting from "${model.name}".`);

  // A prompt on the command line is the opening message, so `--chat "build X"` starts with what
  // was asked for rather than throwing it away.
  let opening: string | null = opts.prompt.trim() || null;
  // Whether the model's name is the user's. A one-shot run names it from the prompt, and `--from`
  // brings its own; a chat has neither, so the first turn that *builds* something names it — from
  // the line that did, and only once, so a long conversation doesn't keep renaming the file.
  let named = Boolean(opts.prompt.trim() || opts.from);

  try {
    for (;;) {
      if (opening === null && lines.prompt()) reporter.awaitInput();
      const raw = opening ?? (await lines.next());
      opening = null;
      const line = raw?.trim() ?? null;
      if (line === null) break; // Ctrl-D, or the input ended
      if (!line) continue;

      if (line.startsWith("/")) {
        const [name, ...rest] = line.split(/\s+/);
        const command = COMMANDS.find((c) => c.names.includes(name!));
        if (!command) {
          out(`No such command: ${name} — /help lists them.`);
          continue;
        }
        if (command.run({ model, opts, out }, rest.join(" ").trim()) === "exit") break;
        continue;
      }

      controller = new AbortController();
      reporter.beginTurn();
      try {
        await runAgentTurn(connection, session, line, () => model, reporter.callbacks, {
          signal: controller.signal,
          maxToolRounds: opts.rounds,
          executeToolCall: makeToolExecutor(runPython),
        });
      } catch (err) {
        // A failed turn is not a failed session: say what happened and go back to the prompt. That
        // is safe to do because a round is all-or-nothing with respect to the conversation — a
        // backend that throws leaves no half-written turn in it (see AgentBackend.streamRound) —
        // and because the model keeps whatever the tool calls before the failure had built.
        reporter.say(`  ! ${describeError(err)}`);
      } finally {
        controller = null;
      }

      if (!named && !isEmpty(model)) {
        model.name = nameFromPrompt(line) || model.name;
        named = true;
      }
    }
  } finally {
    lines.close();
  }

  return { model, stoppedEarly: reporter.stoppedEarly(), seconds: (Date.now() - started) / 1000 };
}
