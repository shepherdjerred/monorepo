import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { z, ZodError } from "zod";
import {
  BrainUpstreamError,
  type BrainDecision,
  type BrainDependencies,
} from "./brain.ts";
import type { BrainConfig } from "./config.ts";
import type { FlowFlags } from "./flags.ts";
import type { BrainMetrics } from "./metrics.ts";
import { ClassifyRequestSchema, TriageRequestSchema } from "./schemas.ts";
import type { AggregateLlmUsage } from "@shepherdjerred/llm-runtime";
import { ConversationRequestSchema } from "./conversation-schema.ts";
import { ConversationBudgetError } from "./conversation-budget.ts";
import type { Conversation } from "./conversation.ts";

export type BrainLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
};

export type BrainAppDependencies = {
  brain: BrainDependencies;
  flags: FlowFlags;
  logger: BrainLogger;
  metrics: BrainMetrics;
  conversation: { enabled: () => Promise<boolean>; decide: Conversation };
};

type Flow = "classify" | "triage" | "conversation";

class PayloadTooLargeError extends Error {}
class InvalidJsonError extends Error {}

function writeLog(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    level,
    message,
    service: "storm-brain",
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else process.stdout.write(`${line}\n`);
}

export function createBrainLogger(): BrainLogger {
  return {
    error: (message, fields) => {
      writeLog("error", message, fields);
    },
    info: (message, fields) => {
      writeLog("info", message, fields);
    },
    warn: (message, fields) => {
      writeLog("warn", message, fields);
    },
  };
}

function bearerToken(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) === true
    ? header.slice(prefix.length)
    : undefined;
}

function bearerMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (presented === undefined) return false;
  const actualHash = createHash("sha256").update(presented).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function readBoundedBody(
  request: Request,
  maxBodyBytes: number,
): Promise<{ bytes: number; text: string }> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isInteger(contentLength) || contentLength < 0) {
      throw new InvalidJsonError("invalid Content-Length");
    }
    if (contentLength > maxBodyBytes) throw new PayloadTooLargeError();
  }

  if (request.body === null) return { bytes: 0, text: "" };
  const reader = request.body.getReader();
  const ReadResultSchema = z.object({
    done: z.boolean(),
    value: z.instanceof(Uint8Array).optional(),
  });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let done = false;
  while (!done) {
    const result = ReadResultSchema.parse(await reader.read());
    done = result.done;
    if (done) continue;
    const chunk = result.value;
    if (chunk === undefined) {
      throw new InvalidJsonError("request stream returned no bytes");
    }
    bytes += chunk.byteLength;
    if (bytes > maxBodyBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(chunk);
  }
  return {
    bytes,
    text: Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      bytes,
    ).toString("utf8"),
  };
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    throw new InvalidJsonError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function createBrainApp(
  config: BrainConfig,
  dependencies: BrainAppDependencies,
): Hono {
  const app = new Hono();

  app.get("/livez", (context) => context.text("ok\n"));
  app.get("/readyz", (context) => context.json({ status: "ready" }));

  app.post(
    "/v1/classify",
    flowRoute("classify", ClassifyRequestSchema, {
      enabled: dependencies.flags.classifyEnabled,
      decide: dependencies.brain.classify,
      config,
      dependencies,
    }),
  );
  app.post(
    "/v1/triage",
    flowRoute("triage", TriageRequestSchema, {
      enabled: dependencies.flags.triageEnabled,
      decide: dependencies.brain.triage,
      config,
      dependencies,
    }),
  );

  app.post(
    "/v1/conversation",
    flowRoute("conversation", ConversationRequestSchema, {
      enabled: dependencies.conversation.enabled,
      decide: dependencies.conversation.decide,
      config,
      dependencies,
    }),
  );
  return app;
}

type FlowRouteOptions<Request, Body> = {
  enabled: () => Promise<boolean>;
  decide: (request: Request) => Promise<BrainDecision<Body>>;
  config: BrainConfig;
  dependencies: BrainAppDependencies;
};

function flowRoute<Request, Response>(
  flow: Flow,
  schema: z.ZodType<Request>,
  options: FlowRouteOptions<Request, Response>,
) {
  const { config, dependencies } = options;
  return async (context: Context) => {
    const stopTimer = dependencies.metrics.requestDurationSeconds.startTimer({
      flow,
    });
    const outcome = (name: string) => {
      dependencies.metrics.requestsTotal.inc({ flow, outcome: name });
    };

    const gated = await checkGate(context, config, schema);
    if (gated.ok) {
      dependencies.metrics.payloadBytes.observe({ flow }, gated.bytes);
      return decide(context, flow, {
        request: gated.request,
        options,
        stopTimer,
        outcome,
      });
    }
    stopTimer();
    outcome(gated.outcome);
    if (gated.log !== undefined) {
      dependencies.logger.warn(gated.log.message, {
        error: gated.log.error,
        flow,
      });
    }
    return gated.response;
  };
}

type Gate<Request> =
  | { ok: true; request: Request; bytes: number }
  | {
      ok: false;
      response: Response;
      outcome: string;
      log?: { message: string; error: unknown };
    };

async function checkGate<Request>(
  context: Context,
  config: BrainConfig,
  schema: z.ZodType<Request>,
): Promise<Gate<Request>> {
  if (
    !bearerMatches(
      bearerToken(context.req.header("authorization")),
      config.bearerToken,
    )
  ) {
    return {
      ok: false,
      response: context.text("unauthorized\n", 401),
      outcome: "unauthorized",
      log: {
        message: "Rejected unauthorized brain request",
        error: "bad token",
      },
    };
  }

  if (
    context.req
      .header("content-type")
      ?.toLowerCase()
      .startsWith("application/json") !== true
  ) {
    return {
      ok: false,
      response: context.text("application/json required\n", 415),
      outcome: "unsupported_media_type",
    };
  }

  try {
    const body = await readBoundedBody(context.req.raw, config.maxBodyBytes);
    return {
      ok: true,
      request: schema.parse(parseJson(body.text)),
      bytes: body.bytes,
    };
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return {
        ok: false,
        response: context.text("payload too large\n", 413),
        outcome: "too_large",
      };
    }
    return {
      ok: false,
      response: context.text("invalid request\n", 400),
      outcome: "invalid",
      log: {
        message: "Rejected invalid brain request",
        error: issueCodes(error),
      },
    };
  }
}

/** Validation failures log codes and paths only: values may be user text. */
function issueCodes(error: unknown): unknown {
  if (error instanceof ZodError) {
    return error.issues
      .slice(0, 8)
      .map((issue) => ({ code: issue.code, path: issue.path }));
  }
  return error instanceof Error ? error.message : String(error);
}

type Decide<Request, Body> = {
  request: Request;
  options: FlowRouteOptions<Request, Body>;
  stopTimer: (labels?: Record<string, string>) => void;
  outcome: (name: string) => void;
};

async function decide<Request, Body>(
  context: Context,
  flow: Flow,
  args: Decide<Request, Body>,
): Promise<Response> {
  const { request, options, stopTimer, outcome } = args;
  const { dependencies } = options;
  try {
    if (!(await options.enabled())) {
      stopTimer();
      outcome("disabled");
      dependencies.logger.info("Flow is disabled by flag", { flow });
      return context.text("flow disabled\n", 503);
    }
    const decided = await options.decide(request);
    stopTimer();
    outcome("success");
    charge(flow, decided.usage, dependencies.metrics);
    dependencies.logger.info("Brain request decided", {
      costMicros: Math.round(decided.usage.catalogCostUsd * 1_000_000),
      flow,
    });
    return context.json(decided.response);
  } catch (error) {
    stopTimer();
    if (error instanceof ConversationBudgetError) {
      outcome("budget_exhausted");
      return context.text("conversation unavailable\n", 429);
    }
    if (error instanceof BrainUpstreamError) {
      if (error.usage !== undefined) {
        charge(flow, error.usage, dependencies.metrics);
      }
      outcome("upstream_error");
      dependencies.logger.error("Brain upstream call failed", {
        error: error.message,
        flow,
      });
      return context.text("upstream error\n", 502);
    }
    outcome("error");
    dependencies.logger.error("Brain request failed", {
      error: error instanceof Error ? error.message : String(error),
      flow,
    });
    return context.text("brain error\n", 500);
  }
}

function charge(
  flow: Flow,
  usage: AggregateLlmUsage,
  metrics: BrainMetrics,
): void {
  metrics.costMicrosTotal.inc(
    { flow },
    Math.round(usage.catalogCostUsd * 1_000_000),
  );
  metrics.tokensTotal.inc({ flow, kind: "input" }, usage.tokens.input);
  metrics.tokensTotal.inc({ flow, kind: "output" }, usage.tokens.output);
  metrics.tokensTotal.inc({ flow, kind: "cached" }, usage.tokens.cachedInput);
  metrics.tokensTotal.inc({ flow, kind: "reasoning" }, usage.tokens.reasoning);
  metrics.tokensTotal.inc(
    { flow, kind: "cache_write" },
    usage.tokens.cacheWrite,
  );
}
