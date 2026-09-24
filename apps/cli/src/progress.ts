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
        say(`  ! connection dropped (${describe(err)}) — retrying in ${Math.round(delayMs / 1000)}s (${attempt + 1} of ${maxAttempts})`),
      onHistorySummarized: (messages) => say(`  · compacted ${messages} earlier messages`),
      onStoppedEarly: (_reason, rounds) => {
        stopped = true;
        say(`  ! stopped after ${rounds} tool-call rounds without finishing — the file is what got built`);
      },
      onAborted: () => say("  ! interrupted — writing what was built so far"),
    },
  };
}

function tick(result: ToolCallResult): string {
  return result.ok ? "✓" : "✗";
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
