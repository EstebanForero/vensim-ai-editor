// What the run looks like from the terminal's side.
//
// The agent reports through callbacks (see @vensim-ai/agent's AgentCallbacks), and this is the one
// place that decides which of them become lines, what those lines say, and where they go. Keeping
// it separate from the run itself means a different presentation — a JSON stream, a progress bar,
// silence — is another file implementing the same shape rather than a set of conditionals threaded
// through the command.

import type { AgentCallbacks, ToolCallResult } from "@vensim-ai/agent";

export interface Reporter {
  callbacks: AgentCallbacks;
  /** A line the command itself wants to say (setup, notices) in the same voice. */
  say(line: string): void;
  /** Set when the turn ended without the model deciding it was done. */
  stoppedEarly(): boolean;
}

/**
 * The same, for a session with more than one turn in it.
 *
 * `beginTurn` is what a one-shot run doesn't need and a conversation can't do without: the flags
 * that describe how a turn went ("did it stop early?", "is a line of text half-written?") belong
 * to the turn, and one turn's answer must not be read as the next one's.
 */
export interface ChatReporter extends Reporter {
  beginTurn(): void;
  /** The prompt is on screen with the cursor sitting after it, so whatever is drawn next — a tool
   * line, the reply — needs a line of its own first, or it reads as though the user typed it. */
  awaitInput(): void;
}

/** Progress goes to stderr and the result to stdout, so `vensim-ai-generate … > model.mdl` and
 * `… | jq` do the obvious thing while the human still sees what's happening. */
export function createReporter(quiet: boolean): Reporter {
  let stopped = false;

  const say = (line: string) => {
    if (!quiet) process.stderr.write(line + "\n");
  };

  return {
    say,
    stoppedEarly: () => stopped,
    callbacks: {
      onToolCallStart: (name) => say(`  → ${name}`),
      onToolCall: (name, args, result) => {
        // Rewrites the "→ name" line above rather than adding a second one: a long build is a
        // list of actions, not a list of intentions followed by a list of outcomes.
        if (quiet) return;
        process.stderr.write(`\x1b[1A\x1b[2K  ${tick(result)} ${name} ${summarizeArgs(args)}${result.ok ? "" : ` — ${result.error ?? ""}`}\n`);
      },
      onAssistantText: (text) => {
        if (text.trim()) say("\n" + text.trim() + "\n");
      },
      onRoundRetry: (attempt, maxAttempts, err, delayMs) =>
        say(`  ! connection dropped (${describeError(err)}) — retrying in ${Math.round(delayMs / 1000)}s (${attempt + 1} of ${maxAttempts})`),
      onHistoryCompacted: (messages) => say(`  · dropped ${messages} earlier messages to save context`),
      onStoppedEarly: (_reason, rounds) => {
        stopped = true;
        say(`  ! stopped after ${rounds} tool-call rounds without finishing — the file is what got built`);
      },
      onAborted: () => say("  ! interrupted — writing what was built so far"),
    },
  };
}

/** The chat presentation of the same callbacks.
 *
 * A conversation is not a run's narration, so the split between the two streams moves: the
 * assistant's own words *are* the result of asking something, and go to stdout, while the tool
 * lines stay on stderr as progress. `-q` still means "no progress lines", which in a chat leaves
 * the conversation and drops the machinery.
 *
 * Text is streamed as it arrives — a chat that sits silent for twenty seconds and then prints a
 * paragraph reads as broken. That is what `beginTurn` is for: a half-written line has to be closed
 * before anything else is drawn, or a tool line lands in the middle of the assistant's sentence.
 */
export function createChatReporter(quiet: boolean): ChatReporter {
  let stopped = false;
  let lineOpen = false;
  let streamed = false;

  const say = (line: string) => {
    if (!quiet) process.stderr.write(line + "\n");
  };
  /** Back to a line of our own: the tool line is written and then rewritten in place with a
   * cursor move, which needs to be the last thing on the screen when it happens. */
  const freshLine = () => {
    if (!lineOpen) return;
    process.stdout.write("\n");
    lineOpen = false;
  };
  /** A line about the machinery rather than the conversation — a tool call, a retry, a stop. Quiet
   * means none of them are drawn *and* none of them break the line the reply is being written on. */
  const notice = (line: string) => {
    if (quiet) return;
    freshLine();
    say(line);
  };

  return {
    say,
    stoppedEarly: () => stopped,
    beginTurn: () => {
      stopped = false;
      streamed = false;
      // Not `lineOpen`: that one is not the turn's state but the terminal's, and it is already
      // true at this point — the prompt was drawn, and the cursor is sitting after it. Clearing it
      // here is what put the first tool line of every turn on the prompt's own line.
    },
    awaitInput: () => {
      lineOpen = true;
    },
    callbacks: {
      onToolCallStart: (name) => notice(`  → ${name}`),
      onToolCall: (name, args, result) => {
        if (quiet) return;
        process.stderr.write(`\x1b[1A\x1b[2K  ${tick(result)} ${name} ${summarizeArgs(args)}${result.ok ? "" : ` — ${result.error ?? ""}`}\n`);
      },
      onAssistantTextDelta: (_id, delta) => {
        if (!streamed) freshLine();
        lineOpen = true;
        streamed = true;
        process.stdout.write(delta);
      },
      onAssistantText: (text) => {
        // The streamed copy is already on screen; what's left is to end the line. A reply that
        // wasn't streamed (nothing implements deltas everywhere) is printed whole instead.
        if (streamed) {
          process.stdout.write("\n");
          lineOpen = false;
          streamed = false;
          return;
        }
        if (text.trim()) process.stdout.write(text.trim() + "\n");
      },
      onRoundRetry: (attempt, maxAttempts, err, delayMs) =>
        notice(`  ! connection dropped (${describeError(err)}) — retrying in ${Math.round(delayMs / 1000)}s (${attempt + 1} of ${maxAttempts})`),
      onHistoryCompacted: (messages) => notice(`  · dropped ${messages} earlier messages to save context`),
      onStoppedEarly: (_reason, rounds) => {
        stopped = true;
        notice(`  ! stopped after ${rounds} tool-call rounds without finishing`);
      },
      onAborted: () => notice("  ! interrupted — the model is as it was, and the conversation is where it was"),
    },
  };
}

function tick(result: ToolCallResult): string {
  return result.ok ? "✓" : "✗";
}

/** An error, on one line. Clipped and unwrapped because a proxy or a provider that fails with an
 * HTML page puts the whole page in the message — and a progress line that scrolls a screenful of
 * markup past the conversation is worse than the failure it is reporting. */
export function describeError(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** One line per tool call, with the arguments clipped: a `set_equation` carries a whole equation
 * and a `set_lookup` a whole table, and neither belongs in a progress line. */
export function summarizeArgs(args: Record<string, unknown>): string {
  const line = Object.entries(args)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}=${text.length > 48 ? `${text.slice(0, 45)}…` : text}`;
    })
    .join(" ");
  return line.length > 100 ? `${line.slice(0, 97)}…` : line;
}
