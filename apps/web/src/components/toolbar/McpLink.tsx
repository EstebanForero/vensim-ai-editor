import { useState } from "react";
import { Button } from "@/components/ui/button";

// Same address as apps/mcp/src/address.ts. Shown only while `bun run dev` is running, which is
// when that server is actually listening.
export const MCP_URL = "http://127.0.0.1:8787/mcp";

export function McpLink() {
  const [copied, setCopied] = useState(false);
  if (!import.meta.env.DEV) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 border-t px-3 py-1">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">MCP</span>
      <input
        readOnly
        value={MCP_URL}
        aria-label="MCP server link"
        title="Other agents connect here while bun run dev is running. The model they edit is this server's, not the canvas, until you load or save a .mdl."
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs"
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
