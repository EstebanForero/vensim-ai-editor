#!/usr/bin/env bun
// stdio entry point. A host spawns this process and speaks MCP on stdin/stdout.
// Logging stays on stderr: a single byte of stdout that is not a protocol message breaks the session.

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { applyEnvFile } from "./env.js";
import { createServer } from "./server.js";
import { createSession } from "./session.js";

if (import.meta.main) {
  const envPath = applyEnvFile();
  if (envPath) console.error(`Reading ${envPath}`);
  console.error("vensim-ai MCP server listening on stdio");
  // One model for the process. serveStdio may build a throwaway instance while it negotiates the
  // protocol version; both instances close over this session, so that negotiation cannot split the model.
  const session = createSession();
  serveStdio(() => createServer({ session }));
}
