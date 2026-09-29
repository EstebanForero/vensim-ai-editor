// One sitting: the questions, the answer being typed, the mark, and the score.
//
// No agent and no API key. The questions come from `generateQuestions` in core, the mark comes from
// `gradeAnswer` in core, and this hook holds nothing but the cursor and the running total — which is
// what makes a drill work offline, mark instantly, and never fail half way through.
//
// The questions are taken once, when the sitting starts, rather than derived on every render. The
// model on the canvas can change while a sitting is in progress — the agent editing it, or the user
// — and regenerating then would silently swap the question out from under an answer being typed.
// `restart` is what picks up the current model, which is also why it reads the store directly
// rather than taking the model as an argument that would then go stale.

import { useCallback, useState } from "react";
import { generateQuestions, gradeAnswer, type DrillQuestion, type Verdict } from "@vensim-ai/core";
import { useModelStore } from "@/state/modelStore";
import type { Drill } from "./modes";

export interface DrillSession {
  /** The question in front of the user, or null when the model has nothing to ask about. */
  question: DrillQuestion | null;
  /** Set once the current question has been marked; cleared by `next`. */
  verdict: Verdict | null;
  response: string;
  setResponse(text: string): void;
  /** Mark what is in the box. Does nothing if there is no question, or it is already marked. */
  submit(): void;
  /** Answer a choice question. Picking the option *is* the answer, so this marks it in the same
   * step — there is no separate confirm for something that was clicked. */
  choose(option: string): void;
  /** Swap the current question for one supplied from elsewhere — an AI-written situation, whose
   * archetype the caller chose, so the answer is still the app's and the marking unchanged. */
  replaceQuestion(question: DrillQuestion): void;
  next(): void;
  restart(): void;
  score: { asked: number; correct: number };
  /** 1-based position in the sitting, for "question 2 of 6". */
  position: number;
  total: number;
}

function seed(): number {
  return Math.floor(Math.random() * 100_000);
}

export function useDrillSession(drill: Drill): DrillSession {
  const [sitting, setSitting] = useState(() => {
    const s = seed();
    return { questions: generateQuestions(useModelStore.getState().model, { skills: drill.skills, seed: s, count: drill.count }) };
  });
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [score, setScore] = useState({ asked: 0, correct: 0 });

  const question = sitting.questions[index] ?? null;

  const mark = useCallback(
    (answer: string) => {
      if (!question || verdict) return;
      const marked = gradeAnswer(question, answer);
      setVerdict(marked);
      setScore((s) => ({ asked: s.asked + 1, correct: s.correct + (marked.correct ? 1 : 0) }));
    },
    [question, verdict],
  );

  const submit = useCallback(() => mark(response), [mark, response]);

  const choose = useCallback(
    (option: string) => {
      setResponse(option);
      mark(option);
    },
    [mark],
  );

  const replaceQuestion = useCallback(
    (replacement: DrillQuestion) => {
      setSitting((s) => {
        const questions = [...s.questions];
        // Appended when the sitting had run out, so asking for a fresh one at the end extends it
        // rather than silently doing nothing.
        if (index < questions.length) questions[index] = replacement;
        else questions.push(replacement);
        return { questions };
      });
      setResponse("");
      setVerdict(null);
    },
    [index],
  );

  const next = useCallback(() => {
    setResponse("");
    setVerdict(null);
    setIndex((i) => i + 1);
  }, []);

  const restart = useCallback(() => {
    const s = seed();
    setSitting({
      questions: generateQuestions(useModelStore.getState().model, { skills: drill.skills, seed: s, count: drill.count }),
    });
    setIndex(0);
    setResponse("");
    setVerdict(null);
    setScore({ asked: 0, correct: 0 });
  }, [drill]);

  return {
    question,
    verdict,
    response,
    setResponse,
    submit,
    choose,
    replaceQuestion,
    next,
    restart,
    score,
    position: index + 1,
    total: sitting.questions.length,
  };
}
