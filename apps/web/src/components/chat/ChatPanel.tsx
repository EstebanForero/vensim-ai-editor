import { useReactFlow } from "@xyflow/react";
import { Bot, KeyRound, Loader2, Plus, Send, Settings2, Square, Trash2, TriangleAlert, Wrench } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAgentSession, runAgentTurn, type AgentSession } from "@/lib/agent";
import { PROVIDER_PRESETS } from "@/lib/providerPresets";
import { useModelStore, type ReasoningEffort } from "@/state/modelStore";

/** Shared by the active-profile settings panel and the add-profile form — most models ignore or
 * reject an unrecognized field, so "Default" deliberately means "send nothing," never a guess. */
function ReasoningEffortSelect({ value, onChange }: { value: ReasoningEffort; onChange: (v: ReasoningEffort) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">Reasoning effort</span>
      <select
        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value as ReasoningEffort)}
      >
        <option value="">Default (don't send reasoning_effort)</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </label>
  );
}

/** The "+ Add profile" form — a provider preset just fills in a starting base URL/model; the
 * key is always typed here, never bundled with a preset. */
function AddProfileForm({ onDone }: { onDone: () => void }) {
  const addConnectionProfile = useModelStore((s) => s.addConnectionProfile);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0]!.baseUrl);
  const [model, setModel] = useState(PROVIDER_PRESETS[0]!.model);
  const [apiKey, setApiKey] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("");
  const [presetNote, setPresetNote] = useState<string | undefined>(undefined);

  const applyPreset = (presetName: string) => {
    const preset = PROVIDER_PRESETS.find((p) => p.name === presetName);
    if (!preset) return;
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setPresetNote(preset.note);
    if (!name) setName(preset.name);
  };

  const submit = () => {
    if (!baseUrl.trim() || !model.trim()) return;
    addConnectionProfile({ name: name.trim() || "New profile", apiKey, baseUrl: baseUrl.trim(), model: model.trim(), reasoningEffort });
    onDone();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Provider preset</span>
        <select
          className="h-7 rounded-md border border-input bg-background px-2 text-xs"
          defaultValue={PROVIDER_PRESETS[0]!.name}
          onChange={(e) => applyPreset(e.target.value)}
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {presetNote && <p className="text-muted-foreground">{presetNote}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Profile name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DeepSeek" className="h-7 text-xs" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Base URL</span>
        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-7 text-xs" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Model</span>
        <Input value={model} onChange={(e) => setModel(e.target.value)} className="h-7 text-xs" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">API key</span>
        <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="h-7 text-xs" />
      </label>
      <ReasoningEffortSelect value={reasoningEffort} onChange={setReasoningEffort} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={submit}>
          Add profile
        </Button>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const apiKey = useModelStore((s) => s.apiKey);
  const setApiKey = useModelStore((s) => s.setApiKey);
  const baseUrl = useModelStore((s) => s.baseUrl);
  const setBaseUrl = useModelStore((s) => s.setBaseUrl);
  const aiModel = useModelStore((s) => s.aiModel);
  const setAiModel = useModelStore((s) => s.setAiModel);
  const aiReasoningEffort = useModelStore((s) => s.aiReasoningEffort);
  const setAiReasoningEffort = useModelStore((s) => s.setAiReasoningEffort);
  const connections = useModelStore((s) => s.connections);
  const activeConnectionId = useModelStore((s) => s.activeConnectionId);
  const selectConnectionProfile = useModelStore((s) => s.selectConnectionProfile);
  const deleteConnectionProfile = useModelStore((s) => s.deleteConnectionProfile);
  const renameConnectionProfile = useModelStore((s) => s.renameConnectionProfile);
  const messages = useModelStore((s) => s.chatMessages);
  const addChatMessage = useModelStore((s) => s.addChatMessage);
  const appendToChatMessage = useModelStore((s) => s.appendToChatMessage);
  const finalizeChatMessage = useModelStore((s) => s.finalizeChatMessage);
  const isAgentRunning = useModelStore((s) => s.isAgentRunning);
  const setAgentRunning = useModelStore((s) => s.setAgentRunning);
  const mutate = useModelStore((s) => s.mutate);

  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);
  const [pendingToolName, setPendingToolName] = useState<string | null>(null);
  const sessionRef = useRef<AgentSession>(createAgentSession());
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { fitView } = useReactFlow();

  // Grows the textarea to fit its content (up to the CSS max-h cap, beyond which it scrolls
  // instead) — a fixed `rows={2}` alone just scrolls internally from the very first extra line,
  // which reads as a single-line box with a scrollbar rather than an actually multi-line input.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const send = async () => {
    const text = input.trim();
    if (!text || isAgentRunning) return;
    if (!apiKey) {
      addChatMessage({ id: crypto.randomUUID(), role: "assistant", text: "Set your API key above first." });
      setShowSettings(true);
      return;
    }
    setInput("");
    addChatMessage({ id: crypto.randomUUID(), role: "user", text });
    setAgentRunning(true);
    setPendingToolName(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const streamedIds = new Set<string>();

    // Each tool call must mutate whatever is *currently* the store's live model object, not a
    // snapshot captured once up front — mutate() below replaces that object with a fresh clone
    // after every single tool call (so the canvas updates live), which would orphan a fixed
    // reference after the very first tool ran and silently drop every mutation after it.
    try {
      await runAgentTurn(
        { apiKey, baseUrl, model: aiModel, reasoningEffort: aiReasoningEffort || undefined },
        sessionRef.current,
        text,
        () => useModelStore.getState().model,
        {
          onAssistantTextDelta: (id, delta) => {
            setPendingToolName(null);
            streamedIds.add(id);
            appendToChatMessage(id, delta);
          },
          // The full text already arrived incrementally via onAssistantTextDelta above — this
          // fires alongside it with the same text once the message completes, so all that's
          // left to do here is close out whichever message id was actively streaming.
          onAssistantText: () => {
            for (const id of streamedIds) finalizeChatMessage(id);
            streamedIds.clear();
          },
          onToolCallStart: (name) => setPendingToolName(name),
          onToolCall: (name, toolInput, result) => {
            setPendingToolName(null);
            mutate(() => {}); // re-commit a snapshot of the mutated draft
            addChatMessage({
              id: crypto.randomUUID(),
              role: "tool",
              text: `${result.ok ? "✓" : "✗"} ${name}(${JSON.stringify(toolInput)})${result.ok ? "" : ` — ${result.error}`}`,
            });
            if (name === "auto_layout" && result.ok) requestAnimationFrame(() => fitView({ duration: 300, padding: 0.2 }));
          },
          onStoppedEarly: (_reason, roundsUsed) => {
            addChatMessage({
              id: crypto.randomUUID(),
              role: "warning",
              text: `Stopped after ${roundsUsed} tool-call rounds without finishing the request — it may be only partly done. Send another message (e.g. "continue") to pick up where it left off.`,
            });
          },
          onAborted: () => {
            for (const id of streamedIds) finalizeChatMessage(id);
            addChatMessage({
              id: crypto.randomUUID(),
              role: "warning",
              text: "Stopped. Whatever was already applied stays — send another message to continue or redirect it.",
            });
          },
          onHistorySummarized: (messagesSummarized) => {
            addChatMessage({
              id: crypto.randomUUID(),
              role: "tool",
              text: `Compacted ${messagesSummarized} earlier messages into a summary to save tokens — nothing you did was lost, just condensed.`,
            });
          },
        },
        undefined,
        controller.signal,
      );
    } catch (err) {
      addChatMessage({
        id: crypto.randomUUID(),
        role: "warning",
        text: `Error talking to the model: ${err instanceof Error ? err.message : String(err)} — nothing after the last successful step was applied.`,
      });
    } finally {
      setAgentRunning(false);
      setPendingToolName(null);
      abortControllerRef.current = null;
    }
  };

  const stop = () => abortControllerRef.current?.abort();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <Input
          type="password"
          placeholder="API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="h-7 text-xs"
        />
        <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => setShowSettings((s) => !s)} title="Connection settings">
          <Settings2 className="size-4" />
        </Button>
      </div>

      {showSettings && (
        <div className="flex flex-col gap-2 border-b bg-muted/40 p-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Connection profile</span>
            <div className="flex items-center gap-1">
              <select
                className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                value={activeConnectionId}
                onChange={(e) => selectConnectionProfile(e.target.value)}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.model || "no model set"})
                  </option>
                ))}
              </select>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                onClick={() => deleteConnectionProfile(activeConnectionId)}
                disabled={connections.length <= 1}
                title={connections.length <= 1 ? "Can't delete the only saved profile" : "Delete this profile"}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </label>

          {!addingProfile ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Profile name</span>
                <Input
                  value={connections.find((c) => c.id === activeConnectionId)?.name ?? ""}
                  onChange={(e) => renameConnectionProfile(activeConnectionId, e.target.value)}
                  className="h-7 text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Base URL (any OpenAI-compatible endpoint)</span>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-7 text-xs" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Model</span>
                <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} className="h-7 text-xs" />
              </label>
              <ReasoningEffortSelect value={aiReasoningEffort} onChange={setAiReasoningEffort} />
              <p className="text-muted-foreground">
                Works with OpenAI itself, or any server exposing an OpenAI-compatible <code>/chat/completions</code>{" "}
                route (Azure OpenAI, DeepSeek, Gemini, OpenRouter, vLLM, Ollama, LM Studio, …).
              </p>
              <Button size="sm" variant="outline" className="h-7 justify-start text-xs" onClick={() => setAddingProfile(true)}>
                <Plus className="size-3.5" /> Add another profile
              </Button>
            </>
          ) : (
            <AddProfileForm onDone={() => setAddingProfile(false)} />
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <p className="text-muted-foreground">
            Ask me to build or edit the model, e.g. "Add a stock called Inventory with an inflow Production and
            outflow Shipping" or "Build a causal loop diagram for a simple sales funnel."
          </p>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => {
            // The indicator right below the last message is the only "did this actually
            // finish?" signal otherwise — surfacing it right on the final assistant reply too
            // (not just a transient banner that vanishes when isAgentRunning flips) means
            // scrolling back through history still shows clearly which turns completed.
            const isLastAssistant = m.role === "assistant" && i === messages.length - 1 && !isAgentRunning;
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
                  {m.role === "assistant" && <Bot className="mr-1 inline size-3" />}
                  {m.role === "warning" && <TriangleAlert className="mr-1 inline size-3" />}
                  <span className="whitespace-pre-wrap">{m.text}</span>
                  {m.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-text-bottom" />}
                </div>
                {isLastAssistant && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">Finished — nothing more queued.</div>
                )}
              </div>
            );
          })}
          {isAgentRunning && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {pendingToolName
                ? `Calling ${pendingToolName}…`
                : messages.some((m) => m.streaming)
                  ? "Editing the diagram…"
                  : "Thinking…"}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2 border-t p-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Describe what to build or change… (Shift+Enter for a new line)"
          disabled={isAgentRunning}
          rows={1}
          className="max-h-40 min-h-[2.25rem] resize-none overflow-y-auto text-sm"
        />
        {isAgentRunning ? (
          <Button size="icon" variant="destructive" onClick={stop} className="shrink-0" title="Stop">
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button size="icon" onClick={send} disabled={isAgentRunning} className="shrink-0">
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
