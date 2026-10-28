#!/usr/bin/env bun
// The editor and the MCP server start together. The MCP process prints its URL before Vite
// prints the app's, so the line to copy is the first thing in the terminal.

import { join } from "node:path";
import { MCP_PORT } from "../apps/mcp/src/address.ts";

const root = join(import.meta.dir, "..");
const mcp = Bun.spawn(["bun", "run", "src/http-main.ts"], {
  cwd: join(root, "apps/mcp"),
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
});

// Vite starts only after the MCP port is open, so the link is already printed and Vite cannot
// claim the port while this process is still binding it.
const deadline = Date.now() + 10_000;
for (;;) {
  if (mcp.exitCode !== null) {
    console.error("The MCP server exited before it was ready.");
    process.exit(mcp.exitCode);
  }
  try {
    const response = await fetch(`http://127.0.0.1:${MCP_PORT}/`);
    if (response.status === 404) break;
  } catch {
    // Not listening yet.
  }
  if (Date.now() > deadline) {
    console.error(`The MCP server did not listen on http://127.0.0.1:${MCP_PORT}.`);
    mcp.kill();
    process.exit(1);
  }
  await Bun.sleep(50);
}

const web = Bun.spawn(["bun", "run", "dev"], {
  cwd: join(root, "apps/web"),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  mcp.kill();
  web.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const code = await Promise.race([mcp.exited, web.exited]);
stop();
await Promise.all([mcp.exited, web.exited]);
process.exit(code);
