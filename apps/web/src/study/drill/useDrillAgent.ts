// The AI half of a drill: two jobs, both one turn long.
//
// The thing that makes either of them safe to mark is the same in both cases — the *app* decides
// what is being asked. For a situation, it picks the archetype and the model writes only the prose,
// so the answer is known by construction and `situationQuestion` can reject a reply that gives it
// away. For a practice model, the app decides what the questions will be afterwards, from the model
// by analysis, so nothing the model says about its own work is ever the answer to anything.
//
// That is the line between this and asking the agent a question in the chat panel: there, the model
// both poses and answers. Here it can only ever supply material.
//
// Deliberately no transcript and no memory between turns — each is a fresh session, because a
// sitting should not depend on what was said ten questions ago, and a failed turn should leave
// nothing behind.

import { useCallback, useRef, useState } from "react";
import { createAgentSession, runAgentTurn, type NeutralTool } from "@vensim-ai/agent";
import { ARCHETYPES, situationQuestion, studyArchetype, type ArchetypeId, type DrillQuestion } from "@vensim-ai/core";
import { executeToolCall } from "@/lib/agentTools";
import { useModelStore } from "@/state/modelStore";
import { EDITING_TOOLS } from "../modes";

const RETRY = { maxAttempts: 3, delaysMs: [1000, 3000] };

export interface DrillAgent {
  running: boolean;
  error: string | null;
  /** A fresh situation for this archetype, or null if the turn failed or the reply gave itself
   * away — the caller falls back to a curated one. */
  writeSituation(archetype: ArchetypeId): Promise<DrillQuestion | null>;
  /** Have the agent build a practice model on the canvas. */
  buildModel(problem: string): Promise<boolean>;
}

function situationPrompt(label: string, meaning: string, tell: string): string {
  return `You write short practice situations for someone learning system dynamics.

Write ONE situation — three or four sentences of plain prose about a real-sounding team, place
or organisation — that is unmistakably an instance of ${label}.

It must not name the archetype or any archetype. It must not use the words "reinforcing" or
"balancing", or the phrase "feedback loop", or a loop label like R1 or B1, and must not explain
the structure at all. It describes what happens in the world the way the person living it would:
who does what, what that causes, and what gets worse.

What the pattern is, so that you write something which really has it: ${meaning}

What separates it from a similar-looking pattern, which is the thing being practised: ${tell}

Reply with the situation alone. No heading, no title, no list, no commentary.`;
}

const BUILD_PROMPT = `Build a model on the canvas for someone to practise system-dynamics questions on.

Keep it small enough to read at a glance: two or three stocks at most, each with a clear reason to
accumulate; the rates in Vensim syntax with units; relations drawn so the feedback loops are
actually closed and visible. Two or three loops that do clearly different things is the target.

Run it and confirm it behaves the way you intend. Then stop — do not explain it, do not list the
loops, and do not ask a question. The user will be asked about it.`;

export function useDrillAgent(): DrillAgent {
  const apiKey = useModelStore((s) => s.apiKey);
  const baseUrl = useModelStore((s) => s.baseUrl);
  const aiModel = useModelStore((s) => s.aiModel);
  const aiReasoningEffort = useModelStore((s) => s.aiReasoningEffort);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref as well as the state, because the guard has to be true at the moment a second click
  // lands, not at the moment this callback was built.
  const inFlight = useRef(false);

  const turn = useCallback(
    async (userText: string, system: string, tools: NeutralTool[]): Promise<{ ok: boolean; text: string }> => {
      if (inFlight.current) return { ok: false, text: "" };
      if (!apiKey) {
        setError("No API key set — add one in the AI Chat tab; the connection is shared.");
        return { ok: false, text: "" };
      }
      inFlight.current = true;
      setRunning(true);
      setError(null);

      let text = "";
      try {
        await runAgentTurn(
          { apiKey, baseUrl, model: aiModel, reasoningEffort: aiReasoningEffort || undefined },
          createAgentSession(),
          userText,
          () => useModelStore.getState().model,
          {
            onAssistantText: (t) => {
              text = t;
            },
            onToolCall: () => {
              // The tool mutated the live model; committing a snapshot is what makes the canvas
              // redraw. Empty mutation on purpose — the work is already done.
              useModelStore.getState().mutate(() => {});
            },
            onRoundRetry: (attempt, maxAttempts) =>
              setError(`Connection dropped — retrying (attempt ${attempt + 1} of ${maxAttempts})…`),
          },
          { system, tools, retry: RETRY, executeToolCall },
        );
        return { ok: true, text };
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return { ok: false, text: "" };
      } finally {
        inFlight.current = false;
        setRunning(false);
      }
    },
    [apiKey, baseUrl, aiModel, aiReasoningEffort],
  );

  const writeSituation = useCallback(
    async (archetype: ArchetypeId) => {
      const definition = ARCHETYPES.find((a) => a.id === archetype);
      if (!definition) return null;
      const { ok, text } = await turn(
        "Write one practice situation.",
        situationPrompt(definition.label, definition.meaning, studyArchetype(archetype)?.tell ?? ""),
        // No tools at all: the reply *is* the situation, and the app already knows the answer.
        [],
      );
      if (!ok) return null;
      return situationQuestion(`archetypes:ai:${archetype}:${Date.now()}`, archetype, text);
    },
    [turn],
  );

  const buildModel = useCallback(
    async (problem: string) => {
      const { ok } = await turn(problem.trim() || "Choose a small, familiar situation worth modelling, and build it.", BUILD_PROMPT, EDITING_TOOLS);
      return ok;
    },
    [turn],
  );

  return { running, error, writeSituation, buildModel };
}
