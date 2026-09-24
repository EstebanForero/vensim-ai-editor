// Per-provider quirks for the OpenAI-COMPATIBLE backend specifically (openaiBackend.ts) — a
// provider that needs a genuinely different protocol (Gemini) gets its own backend instead (see
// geminiBackend.ts and backendFor() in agent.ts), not a quirk patched in here.

export interface ProviderAdapter {
  name: string;
  /** Whether this adapter applies to a given connection's base URL. */
  matches(baseUrl: string): boolean;
  /** Extra headers to send on every request — `null` removes a header the SDK would otherwise
   * set by default (the OpenAI client type treats `null` as "omit this header"). */
  headerOverrides?: Record<string, string | null>;
}

const ADAPTERS: ProviderAdapter[] = [];

/** The adapter for `baseUrl`, or null if nothing needs special-casing (the common case — most
 * OpenAI-compatible servers need no workarounds at all). */
export function getProviderAdapter(baseUrl: string): ProviderAdapter | null {
  return ADAPTERS.find((a) => a.matches(baseUrl)) ?? null;
}
