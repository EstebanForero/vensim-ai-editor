// The address `bun run dev` and `bun run mcp` listen on. The editor shows the same URL, so a
// change here has to be copied into apps/web/src/components/toolbar/McpLink.tsx.

// 8787, not a neighbor of Vite's 5173. Vite walks upward from 5173 when that port is taken,
// and it would otherwise try to bind the same port this server is using.
export const MCP_PORT = 8787;
export const MCP_PATH = "/mcp";

export function mcpUrl(port: number = MCP_PORT): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`;
}
