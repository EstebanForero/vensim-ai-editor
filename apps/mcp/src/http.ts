// HTTP entry. Unlike stdio, this has a URL, which is what a client pastes into its MCP settings.
// One process still holds one model: each request builds a fresh protocol instance, and they all
// close over the same session and the same lock.

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { MCP_PATH, MCP_PORT, mcpUrl } from "./address.js";
import { createLock, createServer } from "./server.js";
import { createSession } from "./session.js";

export interface HttpServer {
  url: string;
  stop: () => void;
}

export function startMcpHttp(port: number = MCP_PORT): HttpServer {
  const session = createSession();
  const lock = createLock();
  const handler = createMcpHandler(() => createServer({ session, lock }));
  const hostnames = localhostAllowedHostnames();
  const origins = localhostAllowedOrigins();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== MCP_PATH) return new Response("This is the Vensim MCP server. The endpoint is /mcp.", { status: 404 });
      const rejectedHost = hostHeaderValidationResponse(req, hostnames);
      if (rejectedHost) return rejectedHost;
      const rejectedOrigin = originValidationResponse(req, origins);
      if (rejectedOrigin) return rejectedOrigin;
      return handler.fetch(req);
    },
  });

  return {
    url: mcpUrl(server.port),
    stop: () => {
      server.stop(true);
    },
  };
}
