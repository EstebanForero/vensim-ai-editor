import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { mcpUrl } from "../src/address.js";
import { startMcpHttp } from "../src/http.js";

async function rpc(url: string, id: number, method: string, params?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = await response.text();
  const jsonLine = body
    .split("\n")
    .map((line) => line.replace(/^data:\s?/, ""))
    .find((line) => line.startsWith("{"));
  if (!jsonLine) throw new Error(`no JSON in ${response.status} ${body}`);
  return JSON.parse(jsonLine);
}

describe("HTTP MCP", () => {
  test("keeps one model across requests and is the link the editor shows", async () => {
    const server = startMcpHttp(0);
    try {
      const listed = (await rpc(server.url, 1, "tools/list")) as { result?: { tools?: { name: string }[] } };
      expect(listed.result?.tools?.some((tool) => tool.name === "add_stock")).toBe(true);

      await rpc(server.url, 2, "tools/call", { name: "add_stock", arguments: { name: "People", initial_equation: "3" } });
      const model = (await rpc(server.url, 3, "tools/call", { name: "list_model", arguments: {} })) as {
        result?: { content?: { text?: string }[] };
      };
      expect(model.result?.content?.[0]?.text).toContain("People");

      const editor = readFileSync(join(import.meta.dir, "../../web/src/components/toolbar/McpLink.tsx"), "utf8");
      expect(editor).toContain(mcpUrl());
    } finally {
      server.stop();
    }
  });
});
