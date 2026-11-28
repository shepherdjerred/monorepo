import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import type { Actor } from "@shepherdjerred/artifacts/contract";
import {
  createArtifactsClient,
  type FetchLike,
} from "#lib/artifacts/client.ts";

export const BASE = "https://artifacts.test";

export const ACTOR: Actor = {
  key: "claude-code:session-1",
  kind: "agent",
  name: "claude-code",
  workspaceKey: "karpathy:/work/tree",
  metadata: { hostname: "karpathy", worktree: "/work/tree" },
};

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/** A fresh temporary directory removed after the test. */
export async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "artifacts-cli-"));
  directories.push(directory);
  return directory;
}

/** A tRPC failure as the server's `{error}` envelope. */
export class TrpcFailure extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

export type Call = {
  method: string;
  path: string;
  procedure: string | null;
  input: unknown;
  headers: Headers;
};

type Handlers = {
  trpc?: Record<string, (input: unknown) => unknown>;
  /** Plain HTTP routes (`/api/*`, `/agent/*`). */
  http?: (request: Request) => Response | Promise<Response>;
};

async function procedureInput(request: Request, url: URL): Promise<unknown> {
  if (request.method === "GET") {
    const raw = url.searchParams.get("input");
    return raw === null ? undefined : JSON.parse(raw);
  }
  const text = await request.text();
  return text === "" ? undefined : JSON.parse(text);
}

const notFoundEnvelope = (procedure: string): Response =>
  Response.json(
    {
      error: {
        message: `No procedure ${procedure}`,
        code: -32_004,
        data: { code: "NOT_FOUND", httpStatus: 404 },
      },
    },
    { status: 404 },
  );

async function answer(
  handler: (input: unknown) => unknown,
  input: unknown,
): Promise<Response> {
  try {
    return Response.json({ result: { data: await handler(input) } });
  } catch (error) {
    if (!(error instanceof TrpcFailure)) throw error;
    return Response.json(
      {
        error: {
          message: error.message,
          code: -32_600,
          data: { code: error.code, httpStatus: error.httpStatus },
        },
      },
      { status: error.httpStatus },
    );
  }
}

/**
 * An in-memory service behind an injected `fetch`: tRPC procedures answer with
 * the wire envelope, other routes with whatever the test returns.
 */
export function fakeService(handlers: Handlers = {}) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const request = new Request(input.toString(), init);
    const url = new URL(request.url);
    const procedure = url.pathname.startsWith("/trpc/")
      ? url.pathname.slice("/trpc/".length)
      : null;
    const body = procedure === null ? null : await procedureInput(request, url);
    calls.push({
      method: request.method,
      path: url.pathname + url.search,
      procedure,
      input: body,
      headers: request.headers,
    });
    if (procedure === null)
      return handlers.http === undefined
        ? new Response("not found", { status: 404 })
        : handlers.http(request);
    const handler = handlers.trpc?.[procedure];
    return handler === undefined
      ? notFoundEnvelope(procedure)
      : answer(handler, body);
  };
  return {
    calls,
    fetch: fetchImpl,
    client: (actor: Actor | null = ACTOR) =>
      createArtifactsClient({ baseUrl: BASE, actor, fetch: fetchImpl }),
  };
}

export function sseResponse(
  body: ReadableStream<Uint8Array>,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

/** A stream the test feeds by hand. */
export function controlledStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  return {
    stream,
    send: (message: unknown) => {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(message)}\n\n`),
      );
    },
    raw: (text: string) => {
      controller.enqueue(encoder.encode(text));
    },
    close: () => {
      controller.close();
    },
  };
}

export const IDS = {
  artifact: "11111111-1111-4111-8111-111111111111",
  version: "22222222-2222-4222-8222-222222222222",
  thread: "33333333-3333-4333-8333-333333333333",
  comment: "44444444-4444-4444-8444-444444444444",
  board: "55555555-5555-4555-8555-555555555555",
  upload: "66666666-6666-4666-8666-666666666666",
} as const;

export function feedbackItem(overrides: { body?: string } = {}) {
  return {
    comment: {
      id: IDS.comment,
      body: overrides.body ?? "The header is too tight.\nCan we loosen it?",
      author: { key: "human:jerred", kind: "human" as const, name: "Jerred" },
      createdAt: "2026-11-26T10:00:00.000Z",
    },
    attempt: 1,
    thread: {
      id: IDS.thread,
      anchor: { type: "frame" as const, x: 0.42, y: 0.17 },
      state: "open" as const,
      priorComments: [],
    },
    artifact: {
      id: IDS.artifact,
      title: "Concept B",
      commentedOnVersion: 1,
      currentVersion: 2,
    },
    reviewUrl: `${BASE}/a/${IDS.artifact}?v=1`,
  };
}
