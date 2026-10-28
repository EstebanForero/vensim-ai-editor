// One MCP process edits one model. A client that wants a second model starts a second process —
// stdio servers are already one process per client, which is the session boundary.

import { createAgentSession, type AgentSession } from "@vensim-ai/agent";
import { createEmptyModel, type Model } from "@vensim-ai/core";

export interface Session {
  model: Model;
  /** Conversation the built-in agent continues across ask_agent calls, until the client asks for a fresh one. */
  agent: AgentSession;
}

export function createSession(name = "New Model"): Session {
  return { model: createEmptyModel(name), agent: createAgentSession() };
}
