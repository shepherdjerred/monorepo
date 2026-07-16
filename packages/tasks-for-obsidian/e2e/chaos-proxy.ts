/**
 * Chaos proxy for the Maestro e2e harness. Run with `bun e2e/chaos-proxy.ts`.
 *
 * A raw TCP proxy that pipes bytes between the app and the tasknotes-server
 * so we can simulate the server becoming unreachable at the network level.
 * HTTP-level failures (502 etc.) would surface in the app as ApiError; the
 * offline-queue flows need a real connection failure (ConnectionError), which
 * is why this pipes TCP sockets instead of forwarding via fetch.
 *
 * (node:net rather than Bun.listen so the file typechecks against the
 * repo-pinned @types/node — Bun implements node:net natively.)
 *
 * Control endpoints are served on the SAME port by sniffing the first HTTP
 * request line of each incoming connection:
 *
 *   POST /__chaos/offline  -> refuse/destroy proxied connections
 *   POST /__chaos/online   -> resume proxying
 *   GET  /__chaos/status   -> {"offline":<bool>} (debugging/smoke tests)
 *
 * Control requests always work, even while "offline". Toggling offline also
 * destroys all currently-open proxied connections so keep-alive sockets
 * cannot sneak requests through.
 *
 * Env: CHAOS_PORT (listen port, default 18902)
 *      TARGET_PORT (forward target on 127.0.0.1, default 18901)
 */

import net from "node:net";

function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${name} must be a valid port, got ${JSON.stringify(raw)}`);
  }
  return port;
}

const CHAOS_PORT = portFromEnv("CHAOS_PORT", 18_902);
const TARGET_PORT = portFromEnv("TARGET_PORT", 18_901);

let offline = false;

/** Client sockets currently being proxied — destroyed when going offline. */
const proxiedClients = new Set<net.Socket>();

function httpResponse(status: string, body: string): string {
  const bytes = Buffer.byteLength(body);
  return (
    `HTTP/1.1 ${status}\r\n` +
    `Content-Type: application/json\r\n` +
    `Content-Length: ${String(bytes)}\r\n` +
    `Connection: close\r\n\r\n` +
    body
  );
}

/** Handle a /__chaos/* control request. Returns the full HTTP response. */
function handleControl(requestPath: string): string {
  if (requestPath === "/__chaos/offline") {
    offline = true;
    // Kill in-flight proxied connections so keep-alive sockets fail too.
    for (const client of proxiedClients) {
      client.destroy();
    }
    proxiedClients.clear();
    return httpResponse("200 OK", '{"offline":true}');
  }
  if (requestPath === "/__chaos/online") {
    offline = false;
    return httpResponse("200 OK", '{"offline":false}');
  }
  if (requestPath === "/__chaos/status") {
    return httpResponse("200 OK", `{"offline":${String(offline)}}`);
  }
  return httpResponse("404 Not Found", '{"error":"unknown chaos endpoint"}');
}

const server = net.createServer((client) => {
  /** Bytes received before the routing decision / before upstream is open. */
  let pending: Buffer[] = [];
  let upstream: net.Socket | null = null;
  let decided = false;

  client.on("data", (chunk) => {
    if (upstream !== null) {
      upstream.write(chunk);
      return;
    }
    pending.push(chunk);
    if (decided) return;

    // Wait for the end of the first request line: "METHOD /path HTTP/1.1\r\n"
    const text = Buffer.concat(pending).toString("latin1");
    const lineEnd = text.indexOf("\r\n");
    if (lineEnd === -1) return;
    decided = true;

    const requestPath = text.slice(0, lineEnd).split(" ")[1] ?? "";
    if (requestPath.startsWith("/__chaos/")) {
      // Control request: answered directly, never proxied, works while offline.
      client.end(handleControl(requestPath));
      return;
    }
    if (offline) {
      // Simulated outage: hard-close so the app sees a connection reset,
      // not an HTTP error.
      client.destroy();
      return;
    }

    // Proxy: open the upstream, flush what the client already sent, then pipe.
    proxiedClients.add(client);
    const up = net.connect(TARGET_PORT, "127.0.0.1");
    up.on("connect", () => {
      up.write(Buffer.concat(pending));
      pending = [];
      upstream = up;
    });
    up.on("data", (data) => client.write(data));
    up.on("close", () => client.end());
    up.on("error", () => client.destroy());
  });

  const cleanup = (): void => {
    proxiedClients.delete(client);
    upstream?.destroy();
  };
  client.on("close", cleanup);
  client.on("error", cleanup);
});

server.listen(CHAOS_PORT, "127.0.0.1", () => {
  console.log(
    `[chaos-proxy] listening on 127.0.0.1:${String(CHAOS_PORT)} -> 127.0.0.1:${String(TARGET_PORT)}`,
  );
});
