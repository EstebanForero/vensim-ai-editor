import Anthropic from "@anthropic-ai/sdk";
import type { Model } from "@vensim-ai/core";
import { executeTool, VENSIM_AI_TOOLS } from "@vensim-ai/ai-tools";

const SYSTEM_PROMPT = `You are an assistant embedded in a system-dynamics (Vensim-style) stock-and-flow diagram editor.
You edit the model exclusively through the provided tools — never by describing changes in prose only.
Conventions: Stocks (Levels) accumulate via Flows (Rates); Auxiliaries are computed variables; Constants are
auxiliaries with a fixed value. Use add_connector to link a variable to any other variable whose equation
references it, so the diagram stays legible. Call list_model first if you need to see current state, and
run_simulation after building or changing equations to sanity-check behavior. Keep equations in Vensim syntax
(e.g. "Population * Birth Rate", "IF THEN ELSE(x > 10, 1, 0)"). After you finish making changes, reply with a
short plain-text summary of what you did.`;

export interface AgentCallbacks {
  onToolCall?: (name: string, input: Record<string, unknown>, result: { ok: boolean; result?: unknown; error?: string }) => void;
  onAssistantText?: (text: string) => void;
}

type AnthropicMessage = Anthropic.Messages.MessageParam;

export interface AgentSession {
  history: AnthropicMessage[];
}

export function createAgentSession(): AgentSession {
  return { history: [] };
}

export async function runAgentTurn(
  apiKey: string,
  session: AgentSession,
  userText: string,
  model: Model,
  callbacks: AgentCallbacks = {},
  maxToolRounds = 8,
): Promise<void> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  session.history.push({ role: "user", content: userText });

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: VENSIM_AI_TOOLS as Anthropic.Messages.Tool[],
      messages: session.history,
    });

    session.history.push({ role: "assistant", content: response.content });

    const textParts = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");
    for (const t of textParts) callbacks.onAssistantText?.(t.text);

    const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") return;

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      const result = executeTool(model, call.name, (call.input as Record<string, unknown>) ?? {});
      callbacks.onToolCall?.(call.name, (call.input as Record<string, unknown>) ?? {}, result);
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result.ok ? result.result : { error: result.error }),
        is_error: !result.ok,
      });
    }
    session.history.push({ role: "user", content: toolResults });
  }
}
