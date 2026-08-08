import { stat } from "node:fs/promises";
import path from "node:path";
import { RunSummarySchema, type RunSummary } from "./run-events.ts";
import { readRunManifest } from "./run-recorder.ts";
import { OperatorInputAnswerSchema } from "./schemas.ts";
import { splitAppendedLines } from "./watch-tail.ts";

const POLL_INTERVAL_MS = 300;
const PING_INTERVAL_MS = 20_000;

// The built dashboard bundle lives in the sibling web workspace package. Resolve
// it from this module (not the cwd) so the watcher works however it is launched.
const DIST_DIR = path.join(import.meta.dir, "..", "packages", "web", "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

export type WatchServer = {
  url: string;
  port: number;
  stop: () => void;
};

type TailSource = { name: "event" | "span"; file: string };

// Tail files are created lazily, so a pre-creation ENOENT means "empty so far"
// (returns null). Any other stat failure (EACCES, EIO, …) is a real problem
// that must surface rather than be silently flattened into a zero-length file.
async function tailFileSize(file: string): Promise<number | null> {
  try {
    const stats = await stat(file);
    return stats.size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readOptionalSummary(
  runDirectory: string,
): Promise<RunSummary | null> {
  const file = Bun.file(path.join(runDirectory, "summary.json"));
  if (!(await file.exists())) {
    return null;
  }
  return RunSummarySchema.parse(JSON.parse(await file.text()));
}

/**
 * SSE stream: replay each source file, then poll all of them for appended lines.
 * Each line is delivered as a named SSE event (`event` or `span`) so the client
 * can route it without re-parsing on the server.
 */
function createEventStream(sources: TailSource[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const cursors: {
    source: TailSource;
    offset: number;
    leftover: Buffer;
  }[] = sources.map((source) => ({
    source,
    offset: 0,
    leftover: Buffer.alloc(0),
  }));
  let closed = false;
  let pumping = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (frame: string): boolean => {
        if (closed) {
          return false;
        }
        try {
          controller.enqueue(encoder.encode(frame));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const pump = async (): Promise<void> => {
        if (closed || pumping) {
          return;
        }
        pumping = true;
        try {
          for (const cursor of cursors) {
            const size = (await tailFileSize(cursor.source.file)) ?? 0;
            if (size <= cursor.offset) {
              continue;
            }
            const bytes = Buffer.from(
              await Bun.file(cursor.source.file)
                .slice(cursor.offset, size)
                .arrayBuffer(),
            );
            cursor.offset = size;
            const { lines, remainder } = splitAppendedLines(
              cursor.leftover,
              bytes,
            );
            cursor.leftover = remainder;
            for (const line of lines) {
              if (!emit(`event: ${cursor.source.name}\ndata: ${line}\n\n`)) {
                return;
              }
            }
          }
        } catch (error) {
          // A real stat/read failure (not the expected pre-creation ENOENT)
          // must surface: fail the SSE stream so the client sees an error
          // instead of a silently truncated view.
          closed = true;
          if (pollTimer !== undefined) {
            clearInterval(pollTimer);
          }
          if (pingTimer !== undefined) {
            clearInterval(pingTimer);
          }
          controller.error(
            error instanceof Error ? error : new Error(String(error)),
          );
        } finally {
          pumping = false;
        }
      };

      await pump();
      // The initial replay may have errored the stream (a real read failure) or
      // the client may have disconnected during it; in either case do not emit
      // `ready` or install the poll/ping intervals on an already-closed stream.
      if (closed) {
        return;
      }
      emit("event: ready\ndata: {}\n\n");
      pollTimer = setInterval(() => void pump(), POLL_INTERVAL_MS);
      pingTimer = setInterval(() => emit(": ping\n\n"), PING_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
      }
      if (pingTimer !== undefined) {
        clearInterval(pingTimer);
      }
    },
  });
}

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

/** Serve a built static asset, falling back to index.html for SPA routes. */
async function serveStaticAsset(pathname: string): Promise<Response> {
  const requested = path.resolve(DIST_DIR, `.${pathname}`);
  const withinDist =
    requested === DIST_DIR || requested.startsWith(`${DIST_DIR}${path.sep}`);
  if (withinDist && pathname !== "/") {
    const asset = Bun.file(requested);
    if (await asset.exists()) {
      return new Response(asset);
    }
  }
  const index = Bun.file(INDEX_HTML);
  if (await index.exists()) {
    return new Response(index, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(
    "Dashboard bundle not built. Run `bun run build` in packages/pr-fleet-controller/packages/web.",
    { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

/**
 * Start the read-only live dashboard for one run bundle. Binds loopback only,
 * serves the built client, and streams events.jsonl + spans.jsonl over SSE.
 * Works for a live run (tails the growing files) and a finished one (replays).
 */
export function startWatchServer(options: {
  runDirectory: string;
  port?: number;
  controlSocket?: string;
}): WatchServer {
  const runDirectory = path.resolve(options.runDirectory);
  const sources: TailSource[] = [
    { name: "event", file: path.join(runDirectory, "events.jsonl") },
    { name: "span", file: path.join(runDirectory, "spans.jsonl") },
  ];
  const server = Bun.serve({
    // Loopback only, always. The stream is unauthenticated and carries full
    // operator/model/tool/command payloads, so the host is intentionally not
    // configurable — it must never be reachable off the local machine.
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url);
      const answerMatch = /^\/api\/operator-requests\/([^/]+)\/answer$/.exec(
        url.pathname,
      );
      const isOperatorAnswer =
        answerMatch !== null && request.method === "POST";
      // This head-bound answer endpoint is the live dashboard's sole control;
      // every standalone or historical dashboard lacks a control socket.
      if (isOperatorAnswer) {
        if (options.controlSocket === undefined) {
          return Response.json(
            { error: "This dashboard is read-only" },
            { status: 409 },
          );
        }
        if (request.headers.get("origin") !== url.origin) {
          return Response.json(
            { error: "Invalid request origin" },
            { status: 403 },
          );
        }
        const contentType = request.headers.get("content-type");
        if (
          contentType?.toLowerCase().startsWith("application/json") !== true
        ) {
          return Response.json(
            { error: "Answers must use application/json" },
            { status: 415 },
          );
        }
        try {
          const requestId = answerMatch[1];
          if (requestId === undefined) {
            throw new Error("Missing operator request ID");
          }
          const answer = OperatorInputAnswerSchema.parse(await request.json());
          if (answer.requestId !== decodeURIComponent(requestId)) {
            throw new Error("Answer request ID does not match the URL");
          }
          const response = await fetch(
            `http://controller/operator-requests/${encodeURIComponent(answer.requestId)}/answer`,
            {
              unix: options.controlSocket,
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(answer),
            },
          );
          return new Response(response.body, {
            status: response.status,
            headers: { "content-type": "application/json" },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          );
        }
      }
      switch (url.pathname) {
        case "/api/meta":
          return jsonResponse({
            manifest: await readRunManifest(runDirectory),
            summary: await readOptionalSummary(runDirectory),
            interactive: options.controlSocket !== undefined,
          });
        case "/api/stream":
          return new Response(createEventStream(sources), {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache, no-transform",
              connection: "keep-alive",
            },
          });
        default:
          return serveStaticAsset(url.pathname);
      }
    },
  });
  return {
    url: server.url.href,
    port: server.port ?? 0,
    stop: () => {
      void server.stop(true);
    },
  };
}
