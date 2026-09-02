import { Bot, KeyRound, Send, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAgentSession, runAgentTurn, type AgentSession } from "@/lib/anthropic";
import { useModelStore } from "@/state/modelStore";

export function ChatPanel() {
  const apiKey = useModelStore((s) => s.apiKey);
  const setApiKey = useModelStore((s) => s.setApiKey);
  const messages = useModelStore((s) => s.chatMessages);
  const addChatMessage = useModelStore((s) => s.addChatMessage);
  const isAgentRunning = useModelStore((s) => s.isAgentRunning);
  const setAgentRunning = useModelStore((s) => s.setAgentRunning);
  const model = useModelStore((s) => s.model);
  const mutate = useModelStore((s) => s.mutate);

  const [input, setInput] = useState("");
  const sessionRef = useRef<AgentSession>(createAgentSession());

  const send = async () => {
    const text = input.trim();
    if (!text || isAgentRunning) return;
    if (!apiKey) {
      addChatMessage({ id: crypto.randomUUID(), role: "assistant", text: "Set your Anthropic API key above first." });
      return;
    }
    setInput("");
    addChatMessage({ id: crypto.randomUUID(), role: "user", text });
    setAgentRunning(true);

    // The agent mutates a live draft of the model directly (same object identity as the
    // store), then we commit one fresh snapshot per tool call so the canvas updates live.
    const draft = model;
    try {
      await runAgentTurn(apiKey, sessionRef.current, text, draft, {
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
        text: `Error talking to Claude: ${err instanceof Error ? err.message : String(err)}`,
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
          placeholder="Anthropic API key (sk-ant-...)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <p className="text-muted-foreground">
            Ask me to build or edit the model, e.g. "Add a stock called Inventory with an inflow Production and
            outflow Shipping."
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
          {isAgentRunning && <div className="text-xs text-muted-foreground">Claude is editing the model…</div>}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t p-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Describe what to build or change…"
          disabled={isAgentRunning}
        />
        <Button size="icon" onClick={send} disabled={isAgentRunning}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
