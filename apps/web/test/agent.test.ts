import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAgentSession, isRetriableConnectionError, runAgentTurn, type AgentSession } from "@vensim-ai/agent";
import { createEmptyModel, type Model } from "@vensim-ai/core";

/**
 * These drive the REAL openai SDK against a REAL socket that dies mid-response, because the whole
 * bug being fixed here lives in the gap between the two: the SDK rethrows whatever `fetch` threw
 * with no wrapper class, so classifying these failures means matching on the actual message/code
 * the runtime produces — which differs per runtime (Bun says "The socket connection was closed
 * unexpectedly…", Chrome says "network error", undici says "terminated"). A hand-rolled fake
 * error object would only prove the classifier agrees with itself.
 */

/** Minimal OpenAI-compatible server with three behaviours, chosen per test. */
type Mode = "drop-mid-stream" | "refuse" | "ok" | "ok-after-drop";
let mode: Mode = "ok";
let completions = 0;
let server: ReturnType<typeof Bun.serve> | undefined;
let baseUrl = "";

beforeAll(() => {
  server = Bun.serve({
    // A fixed port, not 0: this Bun reports `server.port` as 0 for an auto-assigned port, which
    // leaves nothing to build the client's base URL from.
    port: 4599,
    // A dropped connection is the point of this server, so a client-side error here is expected
    // noise rather than a problem to report.
    error: () => new Response("", { status: 500 }),
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/__mode")) {
        mode = url.searchParams.get("set") as Mode;
        completions = 0;
        return new Response("ok");
      }
      const body = await req.text();
      // A tool result in the request means a tool already ran this turn — the mock answers those
      // with a plain text reply so the turn can finish, and answers the opening round with a tool
      // call, so a recovered round still has something to execute.
      const isOpeningRound = !/"role"\s*:\s*"tool"/.test(body);
      completions++;
      const drop = mode === "drop-mid-stream" || (mode === "ok-after-drop" && completions === 1);
      if (!drop) {
        const payload = isOpeningRound
          ? {
              choices: [
                {
                  index: 0,
                  delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "list_model", arguments: "{}" } }] },
                  finish_reason: "tool_calls",
                },
              ],
            }
          : { choices: [{ index: 0, delta: { content: "All done." }, finish_reason: "stop" }] };
        return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      // Stream something, then kill the connection without the terminating chunk.
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Sure — I'll add " } }] })}\n\n`));
          setTimeout(() => {
            try {
              // Aborting the body mid-chunked-encoding is what a provider dropping a long
              // streamed reply looks like from the client side.
              controller.error(new Error("connection dropped"));
            } catch {
              /* already closed */
            }
          }, 30);
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}/v1`;
});

afterAll(() => server?.stop(true));

async function setMode(m: Mode) {
  await fetch(`http://127.0.0.1:${server!.port}/__mode?set=${m}`);
}

const connection = () => ({ apiKey: "test", baseUrl, model: "test-model" });

/** A fresh session, deliberately NOT pre-seeded with the user's text: runAgentTurn appends that
 * itself, so seeding it here too would make every "history is untouched" assertion about the
 * wrong message. */
function newSession(): AgentSession {
  return createAgentSession();
}

describe("isRetriableConnectionError", () => {
  // The exact shapes each runtime produces for the same failure — captured by running the real
  // SDK against a socket that dies mid-response (see the header).
  test("recognises a dropped stream in a browser", () => {
    expect(isRetriableConnectionError(new TypeError("network error"))).toBe(true);
    expect(isRetriableConnectionError(new TypeError("Failed to fetch"))).toBe(true);
  });

  test("recognises a dropped stream under Bun and Node", () => {
    expect(isRetriableConnectionError(new TypeError("terminated", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) }))).toBe(true);
    const bun = new TypeError("The socket connection was closed unexpectedly.");
    Object.assign(bun, { code: "ECONNRESET" });
    expect(isRetriableConnectionError(bun)).toBe(true);
  });

  test("recognises a connection that never established", () => {
    expect(isRetriableConnectionError(new Error("Connection error."))).toBe(true);
    expect(isRetriableConnectionError(new Error("fetch failed"))).toBe(true);
  });

  test("retries provider-reported temporary statuses", () => {
    for (const status of [408, 409, 425, 429, 500, 502, 503]) {
      expect(isRetriableConnectionError(Object.assign(new Error("server said no"), { status }))).toBe(true);
    }
  });

  // The distinction that matters most: a bad key or a malformed request fails identically on every
  // retry, so retrying just delays the error the user actually needs to see.
  test("never retries a request the provider rejected on its merits", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetriableConnectionError(Object.assign(new Error("rejected"), { status }))).toBe(false);
    }
  });

  test("a caller's Stop is not a transient failure", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isRetriableConnectionError(new DOMException("aborted", "AbortError"), controller.signal)).toBe(false);
    // ...but an AbortError raised with no caller abort behind it is the SDK's own request timeout.
    expect(isRetriableConnectionError(new DOMException("aborted", "AbortError"))).toBe(true);
  });
});

describe("runAgentTurn: a round that loses its connection", () => {
  test("retries it and completes the turn", async () => {
    await setMode("ok-after-drop");
    const session = newSession();
    const retries: number[] = [];
    const deltas: string[] = [];

    await runAgentTurn(
      connection(),
      session,
      "Build something",
      createEmptyModel,
      {
        onRoundRetry: (attempt) => retries.push(attempt),
        onAssistantTextDelta: (_id, d) => deltas.push(d),
      },
      { retry: { maxAttempts: 3, delaysMs: [0, 0] } },
    );

    expect(retries).toEqual([1]);
    // The turn carried on to completion rather than dying at the drop.
    expect(deltas.join("")).toContain("All done.");
    // The failed attempt's partial reply was never recorded — it appears in the streamed deltas
    // the user watched, but not in the history the model will be asked about next time.
    expect(JSON.stringify(session.history)).not.toContain("Sure — I'll add");
  });

  test("gives up after maxAttempts, leaving history exactly as a fresh failure would", async () => {
    await setMode("drop-mid-stream");
    const session = newSession();
    const retries: number[] = [];

    const err = await runAgentTurn(
      connection(),
      session,
      "Build something",
      createEmptyModel,
      { onRoundRetry: (attempt) => retries.push(attempt) },
      { retry: { maxAttempts: 3, delaysMs: [0, 0] } },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(retries).toEqual([1, 2]); // three attempts total, two retries between them
    // The user's own message plus nothing else: a failed round must leave no partial assistant
    // turn behind, which is what makes retrying (and re-sending by hand) safe.
    expect(session.history).toEqual([{ role: "user", content: "Build something" }]);
  });

  test("a Stop during the retry delay ends the turn instead of waiting it out", async () => {
    await setMode("drop-mid-stream");
    const session = newSession();
    const controller = new AbortController();
    let aborted = false;

    const done = runAgentTurn(
      connection(),
      session,
      "Build something",
      createEmptyModel,
      {
        onAborted: () => {
          aborted = true;
        },
        onRoundRetry: () => controller.abort(),
      },
      {
        // A long delay that the abort must cut short — if it doesn't, this test hangs rather than
        // failing, which is exactly the UI behaviour this guards (a frozen spinner after Stop).
        signal: controller.signal,
        retry: { maxAttempts: 5, delaysMs: [30_000, 30_000] },
      },
    );

    await done;
    expect(aborted).toBe(true);
    expect(session.history).toEqual([{ role: "user", content: "Build something" }]);
  });

  test("a rejected request (401) is reported at once, not retried", async () => {
    // Point at a server that answers with a real HTTP error instead of a dropped socket.
    const rejecting = Bun.serve({
      port: 0,
      fetch: () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401, headers: { "Content-Type": "application/json" } }),
    });
    const retries: number[] = [];
    try {
      const err = await runAgentTurn(
        { apiKey: "bad", baseUrl: `http://127.0.0.1:${rejecting.port}/v1`, model: "m" },
        newSession(),
        "hi",
        createEmptyModel,
        { onRoundRetry: (a) => retries.push(a) },
        { retry: { maxAttempts: 3, delaysMs: [0, 0] } },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(retries).toEqual([]);
    } finally {
      rejecting.stop(true);
    }
  });
});

describe("runAgentTurn: a retried round still executes its tool calls", () => {
  // The retry must not be a special path that skips the rest of the loop: a recovered round has to
  // behave exactly like one that never failed — execute its tools, record the results, and carry
  // on to the next round.
  test("the recovered round's tool call runs and its result reaches the next request", async () => {
    await setMode("ok-after-drop");
    const session = newSession();
    const calls: { name: string; ok: boolean }[] = [];
    const model: Model = createEmptyModel();

    await runAgentTurn(
      connection(),
      session,
      "Add a stock",
      () => model,
      { onToolCall: (name, _input, result) => calls.push({ name, ok: result.ok }) },
      { retry: { maxAttempts: 3, delaysMs: [0, 0] } },
    );

    expect(calls.map((c) => c.name)).toEqual(["list_model"]);
    expect(calls[0]!.ok).toBe(true);
    // user → assistant(tool_calls) → tool(result) → assistant(text): the whole loop ran, on the
    // attempt after the one that died.
    expect(session.history.map((m) => (m as { role: string }).role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(String((session.history[2] as { content: string }).content)).toContain("stocks");
  });
});
