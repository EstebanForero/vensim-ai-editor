// Where ask_agent's credentials come from. The same environment variables as the CLI, so a
// checkout that already generates models does not need a second configuration for the server.
// Flags do not exist here: an MCP host passes configuration through the environment it launches
// the process with.

import { PROVIDER_PRESETS, type AgentConnection, type ProviderPreset } from "@vensim-ai/agent";

const KEY_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  "google gemini": "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "ollama (local)": "OLLAMA_API_KEY",
  custom: "VENSIM_AI_API_KEY",
};

export class ConnectionError extends Error {}

function findPreset(name: string): ProviderPreset {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = slug(name);
  const preset =
    PROVIDER_PRESETS.find((p) => slug(p.name) === wanted) ?? PROVIDER_PRESETS.find((p) => slug(p.name).includes(wanted));
  if (!preset) {
    throw new ConnectionError(`unknown provider "${name}" — try one of: ${PROVIDER_PRESETS.map((p) => p.name).join(", ")}`);
  }
  return preset;
}

/** Resolves the agent endpoint from `env`. Throws {@link ConnectionError} when a key or URL is missing. */
export function resolveConnection(env: NodeJS.ProcessEnv = process.env): AgentConnection {
  const preset = findPreset(env.VENSIM_AI_PROVIDER ?? PROVIDER_PRESETS[0]!.name);
  const baseUrl = env.VENSIM_AI_BASE_URL ?? preset.baseUrl;
  const model = env.VENSIM_AI_MODEL ?? preset.model;

  const keyVar = KEY_VARS[preset.name.toLowerCase()];
  const apiKey = env.VENSIM_AI_API_KEY ?? (keyVar ? env[keyVar] : undefined);
  if (apiKey === undefined) {
    const named = `VENSIM_AI_API_KEY${keyVar && keyVar !== "VENSIM_AI_API_KEY" ? ` (or ${keyVar})` : ""}`;
    throw new ConnectionError(`no API key: set ${named} in the environment this server was launched with`);
  }
  if (!baseUrl) throw new ConnectionError("no endpoint: set VENSIM_AI_BASE_URL (the Custom preset has none)");

  const reasoning = env.VENSIM_AI_REASONING;
  const reasoningEffort = reasoning === "low" || reasoning === "medium" || reasoning === "high" ? reasoning : undefined;
  return { apiKey, baseUrl, model, reasoningEffort };
}
