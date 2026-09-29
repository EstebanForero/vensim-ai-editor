// The study tab: pick what you want to practise, bring the situation, work through it with the
// agent.
//
// Two rows of chips, and they are two genuinely different things:
//
//   Practise  the drills — a question the app asks and marks itself. No API key, no agent, and the
//             mark is a comparison against an analyser's own output rather than a judgement.
//   Ask       the modes — a job given to the agent, which answers.
//
// Selecting one deselects the other, because they share the space below. Nothing here knows what
// any mode or drill does: it renders two tables, collects whatever the selection says it needs, and
// hands the turn to `useStudySession`. That is what makes adding a mode a row in `modes.ts` and
// adding a drill a row in `drill/modes.ts`, rather than a branch in this file.

import { useCallback, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { Eraser, Send, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Transcript } from "@/components/chat/Transcript";
import { allVariables } from "@vensim-ai/core";
import { useModelStore } from "@/state/modelStore";
import { DEFAULT_MODE, MODES, findMode, planTurn } from "./modes";
import { DEFAULT_DRILL, DRILLS, findDrill } from "./drill/modes";
import { DrillPanel } from "./drill/DrillPanel";
import { useStudySession } from "./useStudySession";

/** What the space below the pickers is showing. One selection across both rows, so picking a drill
 * un-picks the mode rather than leaving two things highlighted. */
type Selection = { kind: "drill" | "mode"; id: string };

/** A chip in either picker. Small enough that all of them fit at once — a dropdown would hide the
 * one thing this tab is for, which is knowing what you can practise. */
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[10.5px] whitespace-nowrap transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}

function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 w-14 shrink-0 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

export function StudyPanel() {
  const [selection, setSelection] = useState<Selection>({ kind: "drill", id: DEFAULT_DRILL.id });
  const mode = selection.kind === "mode" ? findMode(selection.id) : DEFAULT_MODE;
  const drill = selection.kind === "drill" ? findDrill(selection.id) : null;
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

  // What is actually on the canvas decides which turn a mode would run — its own, or the one that
  // fills an empty canvas first. Everything the panel shows about the turn comes from the plan, so
  // the badge, the starters and the note cannot describe something other than what will happen.
  const hasModel = useModelStore((s) => allVariables(s.model).length > 0);
  const plan = planTurn(mode, { hasModel });

  const send = () => {
    const text = prompt.trim();
    if ((!text && !state.context.trim()) || state.running) return;
    setPrompt("");
    void session.run(mode, text, plan);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b p-3">
        <div className="mb-2 flex flex-col gap-1.5">
          <Picker label="Practise">
            {DRILLS.map((d) => (
              <Chip key={d.id} label={d.label} active={drill?.id === d.id} onClick={() => setSelection({ kind: "drill", id: d.id })} />
            ))}
          </Picker>
          <Picker label="Ask">
            {MODES.map((m) => (
              <Chip key={m.id} label={m.label} active={selection.kind === "mode" && mode.id === m.id} onClick={() => setSelection({ kind: "mode", id: m.id })} />
            ))}
          </Picker>
        </div>

        {drill ? (
          <p className="text-xs text-muted-foreground">
            <Sparkles className="mr-1 inline size-3" />
            {drill.blurb}
            <span className="ml-1 opacity-70">· the app marks these, no API key needed</span>
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              <Sparkles className="mr-1 inline size-3" />
              {mode.blurb}
              <span className="ml-1 opacity-70">{plan.writes ? "· can change the model on the canvas" : "· reads the model, never changes it"}</span>
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
          </>
        )}
      </div>

      {/* Keyed on the selection so picking another drill starts a fresh sitting rather than carrying
          a half-answered question across — the state is per sitting, and remounting is what says so
          without an effect to reset it. */}
      {drill ? (
        <DrillPanel key={drill.id} drill={drill} />
      ) : (
        <>
          <Transcript
            messages={state.messages}
            running={state.running}
            pendingToolName={session.pendingToolName}
            retryNotice={session.retryNotice}
            workingNote="Reading the model…"
            emptyHint={plan.starters[0]}
          />

          <div className="shrink-0 border-t p-2">
            {/* Only once there is a conversation. Before that the transcript's own hint and the
                starter chip already say what this turn will do, and a third copy of it is noise. */}
            {plan.note && !state.running && state.messages.length > 0 && (
              <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">{plan.note}</p>
            )}
            <StarterRow starters={plan.starters} onPick={setPrompt} disabled={state.running || state.messages.length > 0} />
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
        </>
      )}
    </div>
  );
}

/** The mode's own opening line, offered as a button — a blank box with no idea what to ask is the
 * usual reason a feature like this goes unused. */
function StarterRow({ starters, onPick, disabled }: { starters: string[]; onPick: (text: string) => void; disabled: boolean }) {
  if (disabled) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {starters.map((starter) => (
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
