// Where the credentials and the endpoint come from: flags first, then the environment, then the
// provider preset. One function, so the precedence is stated once rather than re-derived at each
// place a value is needed.

import { PROVIDER_PRESETS, type AgentConnection, type ProviderPreset } from "@vensim-ai/agent";
import { UsageError, type Options } from "./args.js";

/** The environment variable each provider documents for its own key — so a shell that already
 * exports OPENAI_API_KEY for other tools needs no extra setup. VENSIM_AI_API_KEY is tried first
 * for all of them, which is what makes switching providers a one-word change. */
const KEY_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  "google gemini": "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "ollama (local)": "OLLAMA_API_KEY",
  custom: "VENSIM_AI_API_KEY",
};

/** A preset by name, matched loosely: "gemini" finds "Google Gemini", which is what someone with
 * the provider in mind actually types. */
export function findPreset(name: string): ProviderPreset {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = slug(name);
  const preset =
    PROVIDER_PRESETS.find((p) => slug(p.name) === wanted) ?? PROVIDER_PRESETS.find((p) => slug(p.name).includes(wanted));
  if (!preset) {
    throw new UsageError(`unknown provider "${name}" — try one of: ${PROVIDER_PRESETS.map((p) => p.name).join(", ")}`);
  }
  return preset;
}

export interface ResolvedConnection {
  connection: AgentConnection;
  /** Which preset it came from, for the line that says where the request is going. */
  preset: ProviderPreset;
}

/**
 * `envFile` is only ever used to word the error below: a `.env` that was read and had no key in it
 * is a different problem from no `.env` at all, and only one of them means the file is in the
 * wrong place. Nothing else about resolution depends on it.
 */
export function resolveConnection(opts: Options, env: NodeJS.ProcessEnv = process.env, envFile: string | null = null): ResolvedConnection {
  const preset = findPreset(opts.provider ?? env.VENSIM_AI_PROVIDER ?? PROVIDER_PRESETS[0]!.name);
  const baseUrl = opts.baseUrl ?? env.VENSIM_AI_BASE_URL ?? preset.baseUrl;
  const model = opts.model ?? env.VENSIM_AI_MODEL ?? preset.model;

  // Ollama serves locally and takes no key, so an empty one is not an error there — but the
  // empty string has to actually reach the client rather than being treated as "unset".
  const keyVar = KEY_VARS[preset.name.toLowerCase()];
  const apiKey = opts.apiKey ?? env.VENSIM_AI_API_KEY ?? (keyVar ? env[keyVar] : undefined);
  if (apiKey === undefined) {
    const named = `VENSIM_AI_API_KEY${keyVar && keyVar !== "VENSIM_AI_API_KEY" ? ` (or ${keyVar})` : ""}`;
    throw new UsageError(
      `no API key: set ${named}, pass --api-key, ${envFile ? `or put one in ${envFile}` : "or put one in a .env"}`,
    );
  }
  if (!baseUrl) throw new UsageError("no endpoint: pass --base-url (the Custom preset has none)");

  const reasoning = env.VENSIM_AI_REASONING;
  const reasoningEffort = reasoning === "low" || reasoning === "medium" || reasoning === "high" ? reasoning : undefined;
  return { connection: { apiKey, baseUrl, model, reasoningEffort }, preset };
}
