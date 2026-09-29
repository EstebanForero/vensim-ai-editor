// The question card.
//
// One question at a time, an answer box, a mark, and why. Nothing here decides anything: the
// question and its answer come from core, the mark is `gradeAnswer`, and this file only draws them.
// That is deliberate — the moment a component starts deciding whether an answer is close enough, the
// mark stops being traceable to an analyser and the drill stops being worth doing.
//
// It does do two things *around* the question, and both exist because a drill that cannot produce a
// question is not much use:
//
//   - When every question is about the model on the canvas and there isn't one, it offers to have
//     the agent build something to practise on. Being told to go and draw the diagram first is
//     nonsense: drawing it is the thing being learned.
//   - When the questions are about recognising a pattern, it offers a fresh situation from the
//     agent. The archetype is still chosen here, so the answer is still the app's.

import { useCallback, useState } from "react";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { allVariables, pickStudyArchetype, type DrillQuestion } from "@vensim-ai/core";
import { useModelStore } from "@/state/modelStore";
import type { Drill } from "./modes";
import { useDrillAgent } from "./useDrillAgent";
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

/** Shown instead of a question when there is nothing to ask about yet. */
function BuildPrompt({ drill, busy, error, onBuild }: { drill: Drill; busy: boolean; error: string | null; onBuild: (problem: string) => void }) {
  const [problem, setProblem] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{drill.hint}</p>
      <p className="text-xs">
        Every question here is about a model, so there has to be one. Have the agent build you something to practise on —
        working through a model you already know how to build teaches you nothing.
      </p>
      <Input
        value={problem}
        onChange={(e) => setProblem(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onBuild(problem);
        }}
        placeholder="Optional: what should it be about? e.g. a warehouse running out of space"
        className="text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onBuild(problem)} disabled={busy}>
          <Sparkles className="size-3.5" /> {busy ? "Building…" : "Build me one to practise on"}
        </Button>
        <span className="text-[11px] text-muted-foreground">or open an example from the Archetypes dialog</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function DrillPanel({ drill }: { drill: Drill }) {
  const session = useDrillSession(drill);
  const agent = useDrillAgent();
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

  /** Building replaces whatever is on the canvas, so it asks first when there is anything to lose —
   * exactly the contract the Archetypes dialog's "Open example" already has. */
  const build = useCallback(
    async (problem: string) => {
      const current = useModelStore.getState().model;
      if (allVariables(current).length > 0 && !window.confirm("Replace the model on the canvas with a practice model? Save it with Save .mdl first if you want to keep it.")) {
        return;
      }
      if (await agent.buildModel(problem)) session.restart();
    },
    [agent, session],
  );

  /** A fresh situation from the agent. The archetype is chosen here — and deliberately not the one
   * just answered — so the answer never comes from the model's own account of what it wrote. */
  const freshSituation = useCallback(async () => {
    const archetype = pickStudyArchetype(Math.random, question?.archetype);
    const replacement = await agent.writeSituation(archetype);
    if (replacement) session.replaceQuestion(replacement);
  }, [agent, session, question]);

  if (!question) {
    const finished = session.total > 0;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
        {finished ? (
          <>
            <p className="font-medium">That is the sitting.</p>
            <p className="text-xs text-muted-foreground">
              {session.score.correct} of {session.score.asked} right.
            </p>
            <div>
              <Button size="sm" variant="outline" onClick={session.restart}>
                <RotateCcw className="size-3.5" /> Another sitting
              </Button>
            </div>
          </>
        ) : drill.needsModel ? (
          <BuildPrompt drill={drill} busy={agent.running} error={agent.error} onBuild={build} />
        ) : (
          <p className="text-xs text-muted-foreground">{drill.hint}</p>
        )}
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
        <span className="flex items-center gap-0.5">
          {drill.canAskForSituation && (
            <Button size="icon" variant="ghost" className="size-6" onClick={freshSituation} disabled={agent.running} title="Ask the agent for a fresh situation">
              <Sparkles className={`size-3.5 ${agent.running ? "animate-pulse" : ""}`} />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-6" onClick={session.restart} title="Start another sitting">
            <RotateCcw className="size-3.5" />
          </Button>
        </span>
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

        {/* A failed turn leaves the question that is already there, and says so rather than looking
            like nothing happened. */}
        {agent.error && <p className="text-xs text-destructive">{agent.error}</p>}

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
