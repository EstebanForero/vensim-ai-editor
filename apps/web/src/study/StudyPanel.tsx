// The study tab: pick what you want to practise, bring the situation, work through it with the
// agent.
//
// Nothing here knows what any mode does. It renders the mode table, collects whatever that mode
// says it needs (a situation to describe, or nothing but the model on the canvas), and hands the
// turn to `useStudySession` — which is what makes adding a mode a row in `modes.ts` rather than a
// branch in this file. The only thing this panel reads off a mode is `input`, and only to decide
// whether to draw a context box.

import { useCallback, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { Eraser, Send, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Transcript } from "@/components/chat/Transcript";
import { DEFAULT_MODE, MODES, type StudyMode } from "./modes";
import { useStudySession } from "./useStudySession";

/** A mode chip in the picker. Small enough that all of them fit at once — a dropdown would hide
 * the one thing this tab is for, which is knowing what you can practise. */
function ModeChip({ mode, active, onClick }: { mode: StudyMode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
      }`}
    >
      {mode.label}
    </button>
  );
}

export function StudyPanel() {
  const [modeId, setModeId] = useState(DEFAULT_MODE.id);
  const mode = MODES.find((m) => m.id === modeId) ?? DEFAULT_MODE;
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { fitView } = useReactFlow();

  // An editing mode moves the model around; re-framing after a layout call is what makes the
  // result visible instead of built somewhere off-screen — the same thing the chat panel does.
  const onModelChanged = useCallback(
    (toolName: string) => {
      if (toolName === "auto_layout") requestAnimationFrame(() => fitView({ duration: 300, padding: 0.2 }));
    },
    [fitView],
  );
  const session = useStudySession({ onModelChanged });
  const state = session.stateFor(mode);
  const needsContext = mode.input === "context" || mode.input === "context+model";

  const send = () => {
    const text = prompt.trim();
    if ((!text && !state.context.trim()) || state.running) return;
    setPrompt("");
    void session.run(mode, text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <ModeChip key={m.id} mode={m} active={m.id === mode.id} onClick={() => setModeId(m.id)} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <Sparkles className="mr-1 inline size-3" />
          {mode.blurb}
          <span className="ml-1 opacity-70">{mode.writes ? "· can change the model on the canvas" : "· reads the model, never changes it"}</span>
        </p>

        {needsContext && (
          <Textarea
            value={state.context}
            onChange={(e) => session.setContext(mode, e.target.value)}
            placeholder={mode.placeholder}
            rows={2}
            className="mt-2 max-h-32 min-h-[2.5rem] resize-y text-xs"
          />
        )}
      </div>

      <Transcript
        messages={state.messages}
        running={state.running}
        pendingToolName={session.pendingToolName}
        retryNotice={session.retryNotice}
        workingNote="Reading the model…"
        emptyHint={mode.starters[0]}
      />

      <div className="shrink-0 border-t p-2">
        <StarterRow mode={mode} onPick={setPrompt} disabled={state.running} />
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Ask for what you want from "${mode.label}"…`}
            disabled={state.running}
            rows={1}
            className="max-h-40 min-h-[2.25rem] resize-none overflow-y-auto text-sm"
          />
          {state.running ? (
            <Button size="icon" variant="destructive" onClick={session.stop} className="shrink-0" title="Stop">
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button size="icon" onClick={send} className="shrink-0" title="Send">
              <Send className="size-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => session.clear(mode)}
            disabled={state.running || state.messages.length === 0}
            className="shrink-0"
            title="Start this mode over"
          >
            <Eraser className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The mode's own opening line, offered as a button — a blank box with no idea what to ask is the
 * usual reason a feature like this goes unused. */
function StarterRow({ mode, onPick, disabled }: { mode: StudyMode; onPick: (text: string) => void; disabled: boolean }) {
  if (disabled) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {mode.starters.map((starter) => (
        <button
          key={starter}
          type="button"
          onClick={() => onPick(starter)}
          className="max-w-full truncate rounded-md border border-dashed border-border px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
        >
          {starter}
        </button>
      ))}
    </div>
  );
}
