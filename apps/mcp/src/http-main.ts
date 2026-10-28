#!/usr/bin/env bun
// Prints the URL and then serves until the process is killed. Stdout is free here: nothing is
// parsing it as JSON-RPC, which is why the link can be a plain line a person copies.

import { applyEnvFile } from "./env.js";
import { startMcpHttp } from "./http.js";

if (import.meta.main) {
  const envPath = applyEnvFile();
  if (envPath) console.error(`Reading ${envPath}`);
  const server = startMcpHttp();
  console.log("MCP server is running. Copy this link:");
  console.log(server.url);
}
