import {
  context as otelContext,
  isSpanContextValid,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import type { AnyTRPCRouter } from "@trpc/server";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { matchedRoutes } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import type { Registry } from "prom-client";
import { peerAddressOf, type ConsoleEnv } from "./context.ts";
import {
  IdentityRejectedError,
  resolveIdentity,
  type ConsoleIdentity,
  type IdentityScheme,
} from "./identity.ts";
import { createConsoleRegistry, httpMetrics } from "./metrics.ts";
import { mountSpaFallback, mountStaticFiles } from "./static.ts";
import { mountTRPC, type ConsoleTRPCOptions } from "./trpc.ts";

/** One structured line per request. */
export type RequestLogLine = {
  readonly level: "info" | "warn" | "error";
  readonly message: "http_request";
  readonly service: string;
  readonly requestId: string;
  readonly traceId?: string;
  readonly method: string;
  readonly path: string;
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
};

export type ConsoleServerOptions<TRouter extends AnyTRPCRouter> = {
  /** Service name: the log `service`, the metric prefix and the tracer name. */
  readonly name: string;
  readonly port: number;
  /** @default "0.0.0.0" */
  readonly hostname?: string;
  /**
   * The app's own routes. They run after health, metrics, tRPC and the client
   * build's files, and before the SPA fallback.
   */
  readonly routes?: (app: Hono<ConsoleEnv>) => void;
  readonly trpc?: ConsoleTRPCOptions<TRouter>;
  /** The Vite build (`dist/client`). Omit for an API-only server. */
  readonly staticDir?: string;
  /** Serve `index.html` for any unmatched GET. @default true */
  readonly spaFallback?: boolean;
  /** Tried in order; the first that applies names the caller. */
  readonly identity?: readonly IdentityScheme[];
  readonly metrics?: {
    /** @default createConsoleRegistry(name) */
    readonly registry?: Registry;
    /** Refreshes gauges just before a scrape. */
    readonly collect?: () => Promise<void>;
  };
  readonly logging?: {
    /** @default console.warn of the JSON line */
    readonly log?: (line: RequestLogLine) => void;
    /** @default probes and scrapes are not logged */
    readonly skip?: (path: string) => boolean;
  };
  readonly health?: {
    /** `/readyz` is 200 only when every check passes. */
    readonly ready?: Readonly<Record<string, () => Promise<boolean>>>;
  };
  /** Reports an unhandled error (Sentry, the errors console). */
  readonly onError?: (error: unknown) => void;
  /** Runs after the listener has drained, e.g. closing the database. */
  readonly onShutdown?: () => Promise<void>;
};

export type ConsoleServer = {
  readonly app: Hono<ConsoleEnv>;
  readonly registry: Registry;
  /** Listens, and stops gracefully on SIGTERM and SIGINT. */
  readonly start: (options?: {
    readonly handleSignals?: boolean;
  }) => Bun.Server<undefined>;
  /** Ends live subscriptions, drains in-flight requests, then `onShutdown`. */
  readonly stop: () => Promise<void>;
};

const PROBE_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

function defaultLog(line: RequestLogLine): void {
  console.warn(JSON.stringify(line));
}

function routeLabel(c: Context<ConsoleEnv>): string {
  const label = c.var.routeLabel;
  if (label !== undefined) return label;
  const matched = matchedRoutes(c)[c.req.routeIndex]?.path;
  // A catch-all middleware (`*`, stored as `/*`) answered: no route matched.
  return matched === undefined || matched === "*" || matched === "/*"
    ? "unmatched"
    : matched;
}

function levelFor(status: number): RequestLogLine["level"] {
  if (status >= 500) return "error";
  return status >= 400 ? "warn" : "info";
}

async function inServerSpan(
  c: Context<ConsoleEnv>,
  tracerName: string,
  operation: (span: Span) => Promise<void>,
): Promise<void> {
  const carrier = Object.fromEntries(c.req.raw.headers);
  const parent = propagation.extract(otelContext.active(), carrier);
  const tracer = trace.getTracer(tracerName);
  await otelContext.with(parent, async () =>
    tracer.startActiveSpan(
      c.req.method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": c.req.method,
          "url.path": c.req.path,
        },
      },
      async (span) => {
        try {
          await operation(span);
        } finally {
          span.end();
        }
      },
    ),
  );
}

/**
 * The one way a TypeScript console starts: Hono on `Bun.serve`, with health,
 * metrics, structured request logs, tracing, identity, tRPC and the client
 * build wired the same way in every app.
 */
export function createConsoleServer<TRouter extends AnyTRPCRouter>(
  options: ConsoleServerOptions<TRouter>,
): ConsoleServer {
  const app = new Hono<ConsoleEnv>();
  const registry =
    options.metrics?.registry ?? createConsoleRegistry(options.name);
  const http = httpMetrics(registry, options.name);
  const log = options.logging?.log ?? defaultLog;
  const skip = options.logging?.skip ?? ((path) => PROBE_PATHS.has(path));
  const schemes = options.identity ?? [];
  const reportError = (error: unknown): void => {
    options.onError?.(error);
  };
  const shutdown = new AbortController();
  let server: Bun.Server<undefined> | undefined;

  app.use(secureHeaders());

  app.use(async (c, next) => {
    const started = performance.now();
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    let traceId: string | undefined;
    await inServerSpan(c, options.name, async (span) => {
      const spanContext = span.spanContext();
      traceId = isSpanContextValid(spanContext)
        ? spanContext.traceId
        : undefined;
      await next();
      const route = routeLabel(c);
      span.updateName(`${c.req.method} ${route}`);
      span.setAttributes({
        "http.route": route,
        "http.response.status_code": c.res.status,
      });
      if (c.error !== undefined) {
        span.recordException(c.error);
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
    });
    const route = routeLabel(c);
    const durationMs = performance.now() - started;
    http.duration.observe(
      { method: c.req.method, route, status: String(c.res.status) },
      durationMs / 1000,
    );
    if (!skip(c.req.path)) {
      log({
        level: levelFor(c.res.status),
        message: "http_request",
        service: options.name,
        requestId,
        ...(traceId === undefined ? {} : { traceId }),
        method: c.req.method,
        path: c.req.path,
        route,
        status: c.res.status,
        durationMs: Math.round(durationMs),
      });
    }
  });

  app.use(async (c, next) => {
    let pending: Promise<ConsoleIdentity> | undefined;
    c.set("identity", async () => {
      pending ??= resolveIdentity(schemes, {
        request: c.req.raw,
        peerAddress: peerAddressOf(c),
      });
      return pending;
    });
    await next();
  });

  app.get("/healthz", (c) => c.text("ok", 200));
  app.get("/readyz", async (c) => {
    const checks = Object.values(options.health?.ready ?? {});
    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          return await check();
        } catch (error) {
          reportError(error);
          return false;
        }
      }),
    );
    return results.every(Boolean)
      ? c.text("ready", 200)
      : c.text("not ready", 503);
  });
  app.get("/metrics", async (c) => {
    await options.metrics?.collect?.();
    return c.body(await registry.metrics(), 200, {
      "Content-Type": registry.contentType,
    });
  });

  if (options.trpc !== undefined) {
    mountTRPC(app, {
      ...options.trpc,
      service: options.name,
      shutdown: shutdown.signal,
      onError: reportError,
    });
  }
  if (options.staticDir !== undefined) {
    mountStaticFiles(app, options.staticDir);
  }
  options.routes?.(app);
  if (options.staticDir !== undefined && options.spaFallback !== false) {
    mountSpaFallback(app, options.staticDir);
  }

  app.onError((error, c) => {
    if (error instanceof IdentityRejectedError) {
      return c.json({ error: error.message }, error.status);
    }
    if (error instanceof HTTPException) return error.getResponse();
    console.error(
      JSON.stringify({
        level: "error",
        message: "request_failed",
        service: options.name,
        requestId: c.var.requestId,
        path: c.req.path,
        error: error.message,
      }),
    );
    reportError(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  const stop = async (): Promise<void> => {
    shutdown.abort();
    const listening = server;
    server = undefined;
    await listening?.stop();
    await options.onShutdown?.();
  };

  const start: ConsoleServer["start"] = (startOptions) => {
    if (server !== undefined)
      throw new Error(`${options.name} already started`);
    const listening = Bun.serve({
      hostname: options.hostname ?? "0.0.0.0",
      port: options.port,
      // Above the tRPC SSE ping, so a quiet live feed is not cut.
      idleTimeout: 60,
      fetch: async (request, bunServer) =>
        app.fetch(request, {
          peerAddress: bunServer.requestIP(request)?.address ?? null,
        }),
    });
    server = listening;
    console.warn(
      JSON.stringify({
        level: "info",
        message: "server_started",
        service: options.name,
        port: listening.port,
      }),
    );
    if (startOptions?.handleSignals !== false) {
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        process.once(signal, () => {
          void stop();
        });
      }
    }
    return listening;
  };

  return { app, registry, start, stop };
}
