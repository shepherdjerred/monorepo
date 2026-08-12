#!/usr/bin/env bun
import http from "node:http";
import type { Socket } from "node:net";
import { z } from "zod";

type Failure = {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;
};

type ControlRequest = {
  readonly method?: string | undefined;
  readonly socket: Socket;
  readonly [Symbol.asyncIterator]: () => AsyncIterator<Uint8Array | string>;
};

const FailureSchema = z.object({
  method: z.string().min(1),
  path: z.string().startsWith("/"),
  status: z.number().int().min(100).max(599),
  body: z.string().optional(),
});

const listenPort = portFromEnvironment("CHAOS_PORT");
const targetPort = portFromEnvironment("TARGET_PORT");
let offline = false;
const failures: Failure[] = [];
const sockets = new Set<Socket>();

const server = http.createServer((request, response) => {
  queueRequest(request, response);
});

function queueRequest(
  request: ControlRequest & {
    readonly url?: string | undefined;
    readonly headers: http.IncomingHttpHeaders;
  },
  response: http.ServerResponse,
): void {
  void handleRequestSafely(request, response);
}

async function handleRequestSafely(
  request: ControlRequest & {
    readonly url?: string | undefined;
    readonly headers: http.IncomingHttpHeaders;
  },
  response: http.ServerResponse,
): Promise<void> {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error(error);
    request.socket.destroy();
  }
}

async function handleRequest(
  request: ControlRequest & {
    readonly url?: string | undefined;
    readonly headers: http.IncomingHttpHeaders;
  },
  response: http.ServerResponse,
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname.startsWith("/__chaos/")) {
    await handleControl(request, response, requestUrl.pathname);
    return;
  }
  if (offline) {
    request.socket.destroy();
    return;
  }
  const failureIndex = failures.findIndex(
    (failure) =>
      failure.method === (request.method ?? "GET").toUpperCase() &&
      failure.path === requestUrl.pathname,
  );
  if (failureIndex !== -1) {
    const [failure] = failures.splice(failureIndex, 1);
    if (failure === undefined) {
      throw new Error("matched chaos failure disappeared");
    }
    response.writeHead(failure.status, { "content-type": "application/json" });
    response.end(failure.body);
    return;
  }

  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => request.socket.destroy());
  for await (const chunk of request) {
    upstream.write(chunk);
  }
  upstream.end();
}

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

server.listen(listenPort, "127.0.0.1", () => {
  console.error(
    `[chaos-proxy] listening on 127.0.0.1:${String(listenPort)} -> 127.0.0.1:${String(targetPort)}`,
  );
});

async function handleControl(
  request: ControlRequest,
  response: http.ServerResponse,
  pathname: string,
): Promise<void> {
  if (pathname === "/__chaos/offline" && request.method === "POST") {
    offline = true;
    for (const socket of sockets) {
      if (socket !== request.socket) {
        socket.destroy();
      }
    }
    json(response, 200, { offline });
    return;
  }
  if (pathname === "/__chaos/online" && request.method === "POST") {
    offline = false;
    json(response, 200, { offline });
    return;
  }
  if (pathname === "/__chaos/status" && request.method === "GET") {
    json(response, 200, { offline, pendingFailures: failures.length });
    return;
  }
  if (pathname === "/__chaos/fail-next" && request.method === "POST") {
    const value = parseFailure(await readBody(request));
    failures.push(value);
    json(response, 200, { queued: true });
    return;
  }
  json(response, 404, { error: "unknown chaos control" });
}

function parseFailure(raw: string): Failure {
  const value = FailureSchema.parse(JSON.parse(raw));
  return {
    method: value.method.toUpperCase(),
    path: value.path,
    status: value.status,
    body: value.body ?? JSON.stringify({ error: "injected failure" }),
  };
}

async function readBody(request: ControlRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(
  response: http.ServerResponse,
  status: number,
  value: object,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function portFromEnvironment(name: string): number {
  const raw = Bun.env[name];
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must contain a valid TCP port`);
  }
  return value;
}
