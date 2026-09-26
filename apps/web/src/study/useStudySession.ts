// One study conversation: the transcript, the agent session behind it, and the turn itself.
//
// The editor's chat panel does the same job for the model — this is deliberately a second one
// rather than a shared hook, because the two differ in everything that matters: what the turn is
// allowed to do, what the system prompt says, and whose transcript it is. What they *share* is the
// loop (`runAgentTurn`), the tool executor, and the connection the user configured once — so a
// study turn is the same kind of thing as an edit turn, with a narrower brief.
//
// Each mode keeps its own thread. Switching from "Give me an exercise" to "Find the mistakes" and
// back should not answer the second question inside the first's conversation, and the model would
// otherwise see one long thread whose instructions changed half way through.

import { useCallback, useRef, useState } from "react";
import { createAgentSession, isRetriableConnectionError, runAgentTurn, type AgentSession } from "@vensim-ai/agent";
import { executeToolCall } from "@/lib/agentTools";
import { message, type ChatMessage } from "@/components/chat/message";
import { useModelStore } from "@/state/modelStore";
import type { PlannedTurn, StudyMode } from "./modes";

/** How many attempts a round gets, and how long between them — the agent's defaults, which the
 * chat panel uses too. */
const RETRY = { maxAttempts: 3, delaysMs: [1000, 3000] };

interface ModeState {
  messages: ChatMessage[];
  context: string;
  /** True while this mode's turn is in flight, so switching modes doesn't lose the fact that
   * something is still running. */
  running: boolean;
}

const emptyState: ModeState = { messages: [], context: "", running: false };

export interface StudySession {
  stateFor(mode: StudyMode): ModeState;
  setContext(mode: StudyMode, context: string): void;
  pendingToolName: string | null;
  retryNotice: string | null;
  /** Runs one turn for `mode` against `plan` — which is what `planTurn` decided the turn should
   * be, given what is on the canvas. The session never works that out for itself: it is the one
   * place that would then disagree with what the panel told the user was about to happen. */
  run(mode: StudyMode, prompt: string, plan: PlannedTurn): Promise<void>;
  stop(): void;
  clear(mode: StudyMode): void;
}

export interface StudySessionOptions {
  /** Called after a tool has changed the model, so the canvas can pick the change up — the same
   * contract the chat panel honours. */
  onModelChanged?: (toolName: string) => void;
  /** Called when a study turn is over, whatever the outcome. */
  onFinished?: () => void;
}

export function useStudySession({ onModelChanged, onFinished }: StudySessionOptions = {}): StudySession {
  const apiKey = useModelStore((s) => s.apiKey);
  const baseUrl = useModelStore((s) => s.baseUrl);
  const aiModel = useModelStore((s) => s.aiModel);
  const aiReasoningEffort = useModelStore((s) => s.aiReasoningEffort);
  const mutate = useModelStore((s) => s.mutate);

  const [byMode, setByMode] = useState<Record<string, ModeState>>({});
  const [pendingToolName, setPendingToolName] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  // Sessions are deliberately outside React state: the object is mutated in place by the backends,
  // and nothing renders from it — only the transcript that it produced does.
  const sessions = useRef(new Map<string, AgentSession>());
  const aborts = useRef(new Map<string, AbortController>());
  // Which modes have a turn in flight. A ref rather than the state above, because the guard has to
  // be true at the moment a second click happens, not at the moment this callback was built.
  const running = useRef(new Set<string>());

  const patch = useCallback((id: string, next: (state: ModeState) => ModeState) => {
    setByMode((all) => ({ ...all, [id]: next(all[id] ?? emptyState) }));
  }, []);

  const sessionFor = (id: string): AgentSession => {
    const existing = sessions.current.get(id);
    if (existing) return existing;
    const created = createAgentSession();
    sessions.current.set(id, created);
    return created;
  };

  const stop = useCallback(() => {
    for (const controller of aborts.current.values()) controller.abort();
  }, []);

  const clear = useCallback((mode: StudyMode) => {
    aborts.current.get(mode.id)?.abort();
    running.current.delete(mode.id);
    sessions.current.delete(mode.id);
    // The context survives: it describes the situation being studied, not the conversation
    // about it, and re-pasting it after clearing the thread would be pure friction.
    setByMode((all) => ({ ...all, [mode.id]: { ...emptyState, context: all[mode.id]?.context ?? "" } }));
  }, []);

  const run = useCallback(
    async (mode: StudyMode, prompt: string, plan: PlannedTurn) => {
      const id = mode.id;
      if (running.current.has(id)) return;
      if (!apiKey) {
        patch(id, (s) => ({ ...s, messages: [...s.messages, message("warning", "No API key set — add one in the AI Chat tab; the connection is shared.")] }));
        return;
      }

      const context = (byMode[id]?.context ?? "").trim();
      // The context goes in the same message as the question, in a labelled block: a separate
      // message reads as something said *before* the question, which the model then answers as if
      // the context were an earlier turn's subject.
      const text = [prompt.trim(), context && `--- Context ---\n${context}`].filter(Boolean).join("\n\n");

      const streamedId = crypto.randomUUID();
      patch(id, (s) => ({
        ...s,
        running: true,
        messages: [...s.messages, message("user", prompt.trim() || "…"), { id: streamedId, role: "assistant", text: "", streaming: true }],
      }));
      running.current.add(id);
      setPendingToolName(null);
      setRetryNotice(null);

      const controller = new AbortController();
      aborts.current.set(id, controller);
      let attempts = 1;

      const say = (m: ChatMessage) => patch(id, (s) => ({ ...s, messages: [...s.messages, m] }));
      const appendToStream = (delta: string) =>
        patch(id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === streamedId ? { ...m, text: m.text + delta } : m)) }));
      const settleStream = () =>
        patch(id, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === streamedId ? { ...m, streaming: false } : m)) }));

      try {
        await runAgentTurn(
          { apiKey, baseUrl, model: aiModel, reasoningEffort: aiReasoningEffort || undefined },
          sessionFor(id),
          text,
          () => useModelStore.getState().model,
          {
            onAssistantTextDelta: (_sid, delta) => {
              setPendingToolName(null);
              setRetryNotice(null);
              appendToStream(delta);
            },
            // The full text arrives incrementally above; this closes the bubble out.
            onAssistantText: () => settleStream(),
            onToolCallStart: (name) => setPendingToolName(name),
            onToolCall: (name, input, result) => {
              setPendingToolName(null);
              // The tool mutated the live model in place; committing a snapshot is what makes the
              // canvas re-render and show it. Empty mutation on purpose — the work is already done.
              mutate(() => {});
              say(message("tool", `${result.ok ? "✓" : "✗"} ${name}(${JSON.stringify(input)})${result.ok ? "" : ` — ${result.error}`}`));
              onModelChanged?.(name);
            },
            onStoppedEarly: (_reason, rounds) =>
              say(message("warning", `Stopped after ${rounds} tool-call rounds without finishing — ask again to continue.`)),
            onRoundRetry: (attempt, maxAttempts, err, delayMs) => {
              attempts = attempt + 1;
              // The retry re-streams this message from scratch, and the model never recorded the
              // half that arrived, so drop it rather than showing both.
              patch(id, (s) => ({ ...s, messages: s.messages.filter((m) => m.id !== streamedId) }));
              setRetryNotice(
                `Connection dropped (${err instanceof Error ? err.message : String(err)}) — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1} of ${maxAttempts})…`,
              );
            },
            onAborted: () => {
              settleStream();
              say(message("warning", "Stopped."));
            },
          },
          { signal: controller.signal, system: plan.system, tools: plan.tools, retry: RETRY, executeToolCall },
        );
      } catch (err) {
        settleStream();
        const what = isRetriableConnectionError(err) ? "Connection failed" : "Failed";
        const tries = attempts > 1 ? ` after ${attempts} attempts` : "";
        say(message("warning", `${what}${tries}: ${err instanceof Error ? err.message : String(err)}`));
      } finally {
        running.current.delete(id);
        patch(id, (s) => ({ ...s, running: false }));
        setPendingToolName(null);
        setRetryNotice(null);
        aborts.current.delete(id);
        onFinished?.();
      }
    },
    [byMode, apiKey, baseUrl, aiModel, aiReasoningEffort, mutate, patch, onModelChanged, onFinished],
  );

  return {
    stateFor: (mode) => byMode[mode.id] ?? emptyState,
    setContext: (mode, context) => patch(mode.id, (s) => ({ ...s, context })),
    pendingToolName,
    retryNotice,
    run,
    stop,
    clear,
  };
}
