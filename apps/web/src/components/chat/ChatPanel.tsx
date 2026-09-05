import { Bot, KeyRound, Send, Settings2, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAgentSession, runAgentTurn, type AgentSession } from "@/lib/openai";
import { useModelStore } from "@/state/modelStore";

export function ChatPanel() {
  const apiKey = useModelStore((s) => s.apiKey);
  const setApiKey = useModelStore((s) => s.setApiKey);
  const baseUrl = useModelStore((s) => s.baseUrl);
  const setBaseUrl = useModelStore((s) => s.setBaseUrl);
  const aiModel = useModelStore((s) => s.aiModel);
  const setAiModel = useModelStore((s) => s.setAiModel);
  const messages = useModelStore((s) => s.chatMessages);
  const addChatMessage = useModelStore((s) => s.addChatMessage);
  const isAgentRunning = useModelStore((s) => s.isAgentRunning);
  const setAgentRunning = useModelStore((s) => s.setAgentRunning);
  const model = useModelStore((s) => s.model);
  const mutate = useModelStore((s) => s.mutate);

  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const sessionRef = useRef<AgentSession>(createAgentSession());

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

    // The agent mutates a live draft of the model directly (same object identity as the
    // store), then we commit one fresh snapshot per tool call so the canvas updates live.
    const draft = model;
    try {
      await runAgentTurn({ apiKey, baseUrl, model: aiModel }, sessionRef.current, text, draft, {
        onToolCall: (name, toolInput, result) => {
          mutate(() => {}); // re-commit a snapshot of the mutated draft
          addChatMessage({
            id: crypto.randomUUID(),
            role: "tool",
            text: `${result.ok ? "✓" : "✗"} ${name}(${JSON.stringify(toolInput)})${result.ok ? "" : ` — ${result.error}`}`,
          });
        },
        onAssistantText: (text) => {
          addChatMessage({ id: crypto.randomUUID(), role: "assistant", text });
        },
      });
    } catch (err) {
      addChatMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Error talking to the model: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setAgentRunning(false);
    }
  };

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
            <span className="text-muted-foreground">Base URL (any OpenAI-compatible endpoint)</span>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-7 text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Model</span>
            <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} className="h-7 text-xs" />
          </label>
          <p className="text-muted-foreground">
            Works with OpenAI itself, or any server exposing an OpenAI-compatible{" "}
            <code>/chat/completions</code> route (Azure OpenAI, OpenRouter, vLLM, Ollama, LM Studio, …).
          </p>
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
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
              <div
                className={
                  "inline-block max-w-[90%] rounded-lg px-3 py-1.5 text-left " +
                  (m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : m.role === "tool"
                      ? "bg-muted font-mono text-[11px] text-muted-foreground"
                      : "bg-secondary text-secondary-foreground")
                }
              >
                {m.role === "tool" && <Wrench className="mr-1 inline size-3" />}
                {m.role === "assistant" && <Bot className="mr-1 inline size-3" />}
                <span className="whitespace-pre-wrap">{m.text}</span>
              </div>
            </div>
          ))}
          {isAgentRunning && <div className="text-xs text-muted-foreground">The model is editing the diagram…</div>}
        </div>
      </div>

      <div className="flex items-end gap-2 border-t p-2">
        <Textarea
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
          rows={2}
          className="max-h-40 min-h-[2.25rem] resize-y text-sm"
        />
        <Button size="icon" onClick={send} disabled={isAgentRunning} className="shrink-0">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
