import type { Model } from "@vensim-ai/core";
import { executeTool, VENSIM_AI_TOOLS } from "@vensim-ai/ai-tools";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolMessageParam } from "openai/resources/chat/completions";

/** Default endpoint for OpenAI itself. Any OpenAI-compatible server (Azure OpenAI's
 * OpenAI-compatible route, a local vLLM/Ollama/LM Studio server, OpenRouter, etc.) works too —
 * just point `baseUrl` at it. */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You are an assistant embedded in a system-dynamics (Vensim-style) stock-and-flow / causal-loop
diagram editor. You edit the model exclusively through the provided tools — never by describing changes in prose
only. Conventions: Stocks (Levels) accumulate via Flows (Rates); Auxiliaries are computed variables; Constants are
auxiliaries with a fixed value; Relations (a.k.a. connectors) are signed causal arrows — set their polarity ("+" or
"-") accurately, since it drives automatic Reinforcing/Balancing feedback-loop detection. A pure causal-loop diagram
can be built with add_auxiliary + add_relation alone, no stocks or flows required. Use add_relation to link a
variable to any other variable whose equation references it, so the diagram stays legible and loops can be found.
Call list_model if you need to see current state, list_loops after wiring up relations to check what feedback loops
you've created, and run_simulation after building or changing equations to sanity-check behavior. Keep equations in
Vensim syntax (e.g. "Population * Birth Rate", "IF THEN ELSE(x > 10, 1, 0)"). Use add_comment for freestanding notes
on the diagram (not equations), and set_sim_spec to change start/stop time, dt, or integration method when asked.
After you finish making changes, reply with a short plain-text summary of what you did.`;

const OPENAI_TOOLS: ChatCompletionTool[] = VENSIM_AI_TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

export interface AgentCallbacks {
  onToolCall?: (name: string, input: Record<string, unknown>, result: { ok: boolean; result?: unknown; error?: string }) => void;
  onAssistantText?: (text: string) => void;
}

export interface AgentSession {
  history: ChatCompletionMessageParam[];
}

export function createAgentSession(): AgentSession {
  return { history: [] };
}

export interface AgentConnection {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export async function runAgentTurn(
  connection: AgentConnection,
  session: AgentSession,
  userText: string,
  model: Model,
  callbacks: AgentCallbacks = {},
  maxToolRounds = 8,
): Promise<void> {
  const client = new OpenAI({
    apiKey: connection.apiKey,
    baseURL: connection.baseUrl || DEFAULT_BASE_URL,
    dangerouslyAllowBrowser: true,
  });
  session.history.push({ role: "user", content: userText });

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await client.chat.completions.create({
      model: connection.model || DEFAULT_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...session.history],
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
    });

    const message = response.choices[0]?.message;
    if (!message) return;
    session.history.push(message);

    if (message.content) callbacks.onAssistantText?.(message.content);

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) return;

    const toolMessages: ChatCompletionToolMessageParam[] = [];
    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // malformed JSON from the model — executeTool will reject missing/invalid fields below
      }
      const result = executeTool(model, call.function.name, args);
      callbacks.onToolCall?.(call.function.name, args, result);
      toolMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result.ok ? result.result : { error: result.error }),
      });
    }
    session.history.push(...toolMessages);
  }
}
