import { z } from "zod";
import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import * as Sentry from "@sentry/bun";
import {
  extractHttpStatus,
  isExpectedUpstreamError,
  RiotTransportError,
} from "#src/league/api/client/errors.ts";
import { withTimeout } from "#src/utils/timeout.ts";

const OperationalErrorSchema = z.object({
  code: z.enum([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "P1001",
    "P1002",
    "P2024",
  ]),
});

export function isExpectedSourceReadError(error: unknown): boolean {
  return (
    error instanceof RiotTransportError ||
    isExpectedUpstreamError(extractHttpStatus(error)) ||
    extractHttpStatus(error) === 429 ||
    OperationalErrorSchema.safeParse(error).success
  );
}

/** Only expected operational failures are optional; corrupt contracts still throw. */
export async function optionalSourceRead<T>(
  source: MatchDataSource,
  read: () => Promise<T>,
  timeoutMs?: number,
): Promise<T | undefined> {
  if (timeoutMs !== undefined && timeoutMs <= 0) return undefined;
  try {
    return await (timeoutMs === undefined
      ? read()
      : withTimeout(read(), timeoutMs));
  } catch (error) {
    const deadlineExpired =
      timeoutMs !== undefined &&
      error instanceof Error &&
      error.message === `API request timed out after ${timeoutMs.toString()}ms`;
    if (!deadlineExpired && !isExpectedSourceReadError(error)) throw error;
    Sentry.captureException(error, {
      tags: { source: "evidence-acquisition", evidenceSource: source },
    });
    return undefined;
  }
}
