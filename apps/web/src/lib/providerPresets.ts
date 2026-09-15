// Base URLs verified directly against each provider's own current docs (not guessed) — see the
// commit that added this file for sources. A preset only fills in the base URL and a starting
// model suggestion; the API key is always typed by the user and never bundled here.
export interface ProviderPreset {
  name: string;
  baseUrl: string;
  model: string;
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    note: '"deepseek-chat" always points at DeepSeek\'s current default model; use a specific dated id (e.g. deepseek-v4-pro) if you need to pin one.',
  },
  {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-3.8-flash",
    note: "Gemini's own OpenAI-compatibility endpoint. Use whatever model id your account currently has access to.",
  },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o" },
  {
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    note: "Requires a locally running Ollama server — no API key needed, leave it blank.",
  },
  { name: "Custom", baseUrl: "", model: "" },
];
