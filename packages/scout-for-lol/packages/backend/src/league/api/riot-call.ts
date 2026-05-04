import type { ZodError } from "zod";
import { type ZodType } from "zod";
import * as Sentry from "@sentry/bun";
import type { MatchId } from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  riotApiErrorsTotal,
  riotApiRequestsTotal,
  riotApiUnknownKeysTotal,
  updateRiotApiHealth,
} from "#src/metrics/index.ts";
import { saveFailedPayloadToS3 } from "#src/storage/s3-helpers.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import { parseWithUnknownKeyFallback } from "#src/league/api/strict-with-loose-fallback.ts";
import {
  extractHttpStatus,
  isExpectedUpstreamError,
} from "#src/league/api/upstream-errors.ts";

const logger = createLogger("riot-call");

type ValidationFailureSaveToS3 = {
  kind: "save-to-s3";
  assetType: "match" | "timeline";
  id: MatchId;
};

export type CallRiotConfig<T> = {
  /** Metric label shared across riotApiRequestsTotal + riotApiErrorsTotal. */
  source: string;
  /** Zod schema parsed via strict-with-fallback. */
  schema: ZodType<T>;
  /**
   * Per-call context (matchId, puuid, alias, region, …) — used as the log
   * prefix and as Sentry tags when an HTTP error is captured.
   */
  context: Record<string, string | number>;
  /**
   * Optional override for the `riotApiUnknownKeysTotal{schema=...}` label.
   * Defaults to `source`. Override to keep historical label values
   * (e.g. `"match"` instead of `"match-data"`) stable across the wrapper
   * migration.
   */
  schemaLabel?: string;
  /**
   * What to do on a validation failure (any non-`unrecognized_keys`
   * Zod issue). Default: silent (just logs + counts the error).
   * `save-to-s3` also persists the raw payload for debugging.
   */
  onValidationFailure?: ValidationFailureSaveToS3;
  /**
   * Capture non-404 / non-upstream HTTP errors to Sentry.
   * 404 and upstream errors (502/503/504) are never captured —
   * they're expected operational signals, not bugs to investigate.
   */
  sentry?: boolean;
};

type CallResult<T> =
  | { kind: "success"; data: T }
  | { kind: "validation-failure"; error: ZodError }
  | { kind: "http-404"; error: unknown }
  | { kind: "http-error"; status: number; error: unknown }
  | { kind: "transport-error"; error: unknown };

function formatContext(context: Record<string, string | number>): string {
  const entries = Object.entries(context);
  if (entries.length === 0) return "";
  return ` [${entries.map(([k, v]) => `${k}=${v.toString()}`).join(", ")}]`;
}

function contextAsTags(
  context: Record<string, string | number>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(context).map(([k, v]) => [k, v.toString()]),
  );
}

/**
 * Internal core: request → metric → parse → audit → policy dispatch.
 * Returns a discriminated result so the two public variants can either
 * fold failures into `undefined` or rethrow. All shared plumbing
 * (metrics, health updates, breadcrumbs, Sentry capture, S3 save,
 * unknown-key audit log) runs in here exactly once per call.
 */
async function runRiotCall<T>(
  config: CallRiotConfig<T>,
  fn: () => Promise<{ response: unknown }>,
): Promise<CallResult<T>> {
  const {
    source,
    schema,
    context,
    schemaLabel = source,
    onValidationFailure,
    sentry = false,
  } = config;
  const contextSuffix = formatContext(context);

  Sentry.addBreadcrumb({
    category: "riot-api",
    message: `Riot API call ${source}${contextSuffix}`,
    data: { source, ...context },
    level: "info",
  });

  let response: { response: unknown };
  try {
    response = await withTimeout(fn());
  } catch (error) {
    const isTimeout =
      error instanceof Error && error.message.includes("timed out");
    riotApiRequestsTotal.inc({
      source,
      status: isTimeout ? "timeout" : "error",
    });
    updateRiotApiHealth(false);

    const status = extractHttpStatus(error);
    if (status === undefined) {
      logger.error(`[${source}] ❌ Error during call${contextSuffix}:`, error);
      riotApiErrorsTotal.inc({ source, http_status: "unknown" });
      return { kind: "transport-error", error };
    }
    if (status === 404) {
      logger.info(`[${source}] ℹ️  404 not found${contextSuffix}`);
      return { kind: "http-404", error };
    }
    if (isExpectedUpstreamError(status)) {
      logger.warn(
        `[${source}] Riot API returned ${status.toString()}${contextSuffix} (expected upstream error)`,
      );
      riotApiErrorsTotal.inc({ source, http_status: status.toString() });
      return { kind: "http-error", status, error };
    }
    logger.error(`[${source}] ❌ HTTP ${status.toString()}${contextSuffix}`);
    riotApiErrorsTotal.inc({ source, http_status: status.toString() });
    if (sentry) {
      Sentry.captureException(error, {
        tags: {
          source,
          httpStatus: status.toString(),
          ...contextAsTags(context),
        },
      });
    }
    return { kind: "http-error", status, error };
  }

  riotApiRequestsTotal.inc({ source, status: "success" });
  updateRiotApiHealth(true);

  const parsed = parseWithUnknownKeyFallback(schema, response.response);
  if (!parsed.ok) {
    logger.error(
      `[${source}] ❌ Validation failed${contextSuffix}:`,
      parsed.error,
    );
    riotApiErrorsTotal.inc({ source, http_status: "validation" });
    if (onValidationFailure?.kind === "save-to-s3") {
      await saveFailedPayloadToS3({
        matchId: onValidationFailure.id,
        assetType: onValidationFailure.assetType,
        rawPayload: response.response,
        validationError: parsed.error,
      });
    }
    return { kind: "validation-failure", error: parsed.error };
  }
  if (parsed.unknownKeyPaths.length > 0) {
    logger.warn(
      `[${source}] ⚠️ Unknown keys${contextSuffix} (parsed leniently): ${parsed.unknownKeyPaths.join(", ")}`,
    );
    riotApiUnknownKeysTotal.inc(
      { schema: schemaLabel },
      parsed.unknownKeyPaths.length,
    );
  }
  return { kind: "success", data: parsed.data };
}

/**
 * Returns `T` on success; `undefined` on any failure (validation, 404,
 * upstream outage, HTTP error, timeout, transport error). All
 * metric/log/Sentry/S3 plumbing runs first.
 */
export async function callRiotOrUndefined<T>(
  config: CallRiotConfig<T>,
  fn: () => Promise<{ response: unknown }>,
): Promise<T | undefined> {
  const result = await runRiotCall(config, fn);
  return result.kind === "success" ? result.data : undefined;
}

/**
 * Returns `T` on success; throws on any failure (after full plumbing
 * runs). Validation failures throw the `ZodError`; HTTP/transport
 * failures throw the underlying error from twisted.
 */
export async function callRiotOrThrow<T>(
  config: CallRiotConfig<T>,
  fn: () => Promise<{ response: unknown }>,
): Promise<T> {
  const result = await runRiotCall(config, fn);
  switch (result.kind) {
    case "success":
      return result.data;
    case "validation-failure":
      throw result.error;
    case "http-404":
    case "http-error":
    case "transport-error":
      throw result.error instanceof Error
        ? result.error
        : new Error(`Riot API call ${config.source} failed (${result.kind})`);
  }
}
