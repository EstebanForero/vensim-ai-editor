// The question card.
//
// One question at a time, an answer box, a mark, and why. Nothing here decides anything: the
// question and its answer come from core, the mark is `gradeAnswer`, and this file only draws them.
// That is deliberate — the moment a component starts deciding whether an answer is close enough, the
// mark stops being traceable to an analyser and the drill stops being worth doing.

import { useCallback } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DrillQuestion } from "@vensim-ai/core";
import type { Drill } from "./modes";
import { useDrillSession } from "./useDrillSession";

/** The choices, as buttons. After marking they carry the verdict: the one that was picked, and —
 * when it was the wrong one — which one was actually right, so the correction is on screen beside
 * the mistake rather than buried in the explanation. */
function Choices({ question, response, marked, onPick }: { question: DrillQuestion; response: string; marked: boolean; onPick: (option: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {(question.options ?? []).map((option) => {
        const picked = option === response;
        const right = option === question.answer;
        const tone = !marked
          ? picked
            ? "border-primary bg-primary/10 text-primary"
            : "border-border hover:bg-accent"
          : right
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : picked
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-border opacity-60";
        return (
          <button
            key={option}
            type="button"
            disabled={marked}
            onClick={() => onPick(option)}
            className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${tone}`}
          >
            {marked && right && <Check className="mr-1 inline size-3" />}
            {marked && picked && !right && <X className="mr-1 inline size-3" />}
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function DrillPanel({ drill }: { drill: Drill }) {
  const session = useDrillSession(drill);
  const { question, verdict } = session;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        session.submit();
      }
    },
    [session],
  );

  // Nothing to ask about: the model-based skills have no model, and there is no error in that —
  // it is the ordinary state of an empty canvas.
  if (!question) {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
        {session.total > 0 ? (
          <>
            <p className="font-medium">That is the sitting.</p>
            <p className="text-xs text-muted-foreground">
              {session.score.correct} of {session.score.asked} right.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{drill.hint}</p>
        )}
        <div>
          <Button size="sm" variant="outline" onClick={session.restart}>
            <RotateCcw className="size-3.5" /> {session.total > 0 ? "Another sitting" : "Try again"}
          </Button>
        </div>
      </div>
    );
  }

  const marked = verdict !== null;
  // A choice is answered by clicking, so there is nothing to submit — but it still has to be
  // marked when the click lands.
  const answerIsChoice = question.kind === "choice";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          Question {session.position} of {session.total}
          {session.score.asked > 0 && ` · ${session.score.correct} of ${session.score.asked} right`}
        </span>
        <Button size="icon" variant="ghost" className="size-6" onClick={session.restart} title="Start another sitting">
          <RotateCcw className="size-3.5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* The situation comes first and in its own block: it is the thing being read, and the
            question underneath it does not make sense until it has been. */}
        {question.situation && (
          <blockquote className="border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
            {question.situation}
          </blockquote>
        )}

        <p className="text-sm">{question.prompt}</p>

        {answerIsChoice ? (
          <Choices question={question} response={session.response} marked={marked} onPick={session.choose} />
        ) : (
          <Textarea
            value={session.response}
            onChange={(e) => session.setResponse(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={marked}
            autoFocus
            rows={2}
            placeholder={question.kind === "numeric" ? "A number…" : "Type your answer, then Enter"}
            className="max-h-40 min-h-[2.5rem] resize-y text-sm"
          />
        )}

        {marked && (
          <div
            className={
              "rounded-md border px-2.5 py-2 text-xs " +
              (verdict.correct
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400")
            }
          >
            <p className="mb-1 flex items-center gap-1 font-medium">
              {verdict.correct ? <Check className="size-3.5" /> : <X className="size-3.5" />}
              {verdict.correct ? "Right" : "Not quite"}
            </p>
            {!verdict.correct && (
              <p className="mb-1">
                Expected: <span className="font-medium">{verdict.expected}</span>
              </p>
            )}
            <p className="whitespace-pre-wrap text-muted-foreground">{question.explanation}</p>
            <p className="mt-1 text-[10px] opacity-70">from {question.source}</p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t p-2">
        {marked ? (
          <Button size="sm" onClick={session.next} autoFocus>
            {session.position >= session.total ? "Finish" : "Next"}
          </Button>
        ) : answerIsChoice ? (
          <span className="text-[11px] text-muted-foreground">Pick an answer.</span>
        ) : (
          <Button size="sm" onClick={session.submit} disabled={session.response.trim() === ""}>
            Check
          </Button>
        )}
      </div>
    </div>
  );
}
