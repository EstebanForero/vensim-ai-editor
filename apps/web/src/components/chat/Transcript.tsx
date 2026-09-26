// The conversation as it's drawn: the messages, and the one line that says what is happening now.
//
// Split out of ChatPanel because it is the part another panel wants. The editor's chat and the
// study tab run the same agent and should look like the same thing when they do — a transcript
// that renders a tool call one way in one tab and another way in the other would make them read as
// two different assistants. Everything it draws is a prop: it knows nothing about the store, the
// connection, or who is running the turn.
//
// An assistant reply is markdown and is drawn as such; every other role is drawn as the literal
// text it is. The split is by role rather than by content because that is what the difference
// actually is — see `Markdown`.

import { Bot, Loader2, RotateCcw, TriangleAlert, Wrench } from "lucide-react";
import { Markdown } from "./Markdown";
import type { ChatMessage } from "./message";

export type { ChatMessage };

export interface TranscriptProps {
  messages: ChatMessage[];
  running: boolean;
  /** The tool call currently executing, if any — shown while a round has no text to stream. */
  pendingToolName?: string | null;
  /** A transient status line (a connection being retried), which disappears on its own. */
  retryNotice?: string | null;
  /** What to say before anything has happened, in the voice of whoever is asking. */
  emptyHint?: string;
  /** Shown under the last assistant message once a turn has finished with nothing queued. */
  finishedNote?: string;
  /** What to say while a round is in flight and has streamed no text yet — the editor is editing
   * the diagram; a study turn is looking at one. */
  workingNote?: string;
}

export function Transcript({
  messages,
  running,
  pendingToolName,
  retryNotice,
  emptyHint,
  finishedNote,
  workingNote = "Thinking…",
}: TranscriptProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 text-sm">
      {messages.length === 0 && emptyHint && <p className="text-muted-foreground">{emptyHint}</p>}
      <div className="flex flex-col gap-3">
        {messages.map((m, i) => {
          // The indicator right below the last message is the only "did this actually finish?"
          // signal otherwise — surfacing it right on the final assistant reply too (not just a
          // transient banner that vanishes when the turn ends) means scrolling back through
          // history still shows clearly which turns completed.
          const isLastAssistant = m.role === "assistant" && i === messages.length - 1 && !running;
          return (
            <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
              <div
                className={
                  "inline-block max-w-[90%] rounded-lg px-3 py-1.5 text-left " +
                  (m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : m.role === "tool"
                      ? "bg-muted font-mono text-[11px] text-muted-foreground"
                      : m.role === "warning"
                        ? "border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-secondary text-secondary-foreground")
                }
              >
                {m.role === "tool" && <Wrench className="mr-1 inline size-3" />}
                {/* Floated, not inline: the reply below is markdown and therefore block-level, and
                    an inline icon ahead of a block lands on a line of its own above it. Floating
                    keeps it at the head of the first line, where it has always been. */}
                {m.role === "assistant" && <Bot className="float-left mt-0.5 mr-1 size-3" />}
                {m.role === "warning" && <TriangleAlert className="mr-1 inline size-3" />}
                {/* The reply is markdown; everything else is literal. A tool line is
                    `add_stock({...})`, where the underscores would become emphasis, and the user's
                    own words are not markup in the first place. The caret while streaming comes
                    from the markdown wrapper, which hangs it off the last block. */}
                {m.role === "assistant" ? (
                  <Markdown streaming={m.streaming}>{m.text}</Markdown>
                ) : (
                  <span className="whitespace-pre-wrap">{m.text}</span>
                )}
              </div>
              {isLastAssistant && finishedNote && <div className="mt-0.5 text-[10px] text-muted-foreground">{finishedNote}</div>}
            </div>
          );
        })}
        {running && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {retryNotice ? <RotateCcw className="size-3.5 animate-spin" /> : <Loader2 className="size-3.5 animate-spin" />}
            {retryNotice ?? (pendingToolName ? `Calling ${pendingToolName}…` : workingNote)}
          </div>
        )}
      </div>
    </div>
  );
}
