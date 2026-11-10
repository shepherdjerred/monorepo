import { z } from "zod";
import type { ArtifactResolution } from "@scout-for-lol/domain/artifacts/resolution.ts";
import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import * as Sentry from "@sentry/bun";
import {
  extractHttpStatus,
  isExpectedUpstreamError,
  RiotTransportError,
  riotSourceAbsence,
  type RiotSourceAbsence,
} from "#src/league/api/client/errors.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import { evidenceRecoveryEnabled } from "./admission.ts";

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

/**
 * An artifact resolution whose `unavailable` outcome states whether the
 * absence is definitive: Riot refused or lacks the artifact and every other
 * source read succeeded empty. `undefined` means an outage, timeout, skipped
 * source, or failed read left the answer open. Assignable to
 * `ArtifactResolution<T>`, so callers that do not care are unaffected.
 */
export type EvidenceResolution<T> =
  | Exclude<ArtifactResolution<T>, { kind: "unavailable" }>
  | (Extract<ArtifactResolution<T>, { kind: "unavailable" }> & {
      readonly definitiveAbsence: RiotSourceAbsence | undefined;
    });

export type SourceRead<T> =
  | { readonly kind: "read"; readonly value: T }
  /** Riot definitively withheld or lacks the resource. */
  | { readonly kind: "absent"; readonly absence: RiotSourceAbsence }
  /** An expected operational failure or expired deadline; retry later. */
  | { readonly kind: "failed" };

/**
 * Riot statuses the evidence path treats as a definitive answer rather than a
 * bug. Production keeps reporting a 403, matching the read policy below.
 */
export function expectedRiotAbsenceStatuses(): readonly number[] {
  return evidenceRecoveryEnabled() ? [403] : [];
}

/**
 * Riot's answer for a read whose failure mode resolves only a 404 to
 * `undefined` (`return_undefined_on_404`); any other mode cannot tell.
 */
export function riotAbsenceOf<T>(
  read: SourceRead<T | undefined>,
): RiotSourceAbsence | undefined {
  if (read.kind === "absent") return read.absence;
  return read.kind === "read" && read.value === undefined
    ? "not_found"
    : undefined;
}

export function isExpectedSourceReadError(error: unknown): boolean {
  return (
    error instanceof RiotTransportError ||
    isExpectedUpstreamError(extractHttpStatus(error)) ||
    extractHttpStatus(error) === 429 ||
    OperationalErrorSchema.safeParse(error).success
  );
}

/** Only expected operational failures are tolerated; corrupt contracts still throw. */
export async function readSource<T>(
  source: MatchDataSource,
  read: () => Promise<T>,
  timeoutMs?: number,
): Promise<SourceRead<T>> {
  if (timeoutMs !== undefined && timeoutMs <= 0) return { kind: "failed" };
  try {
    return {
      kind: "read",
      value: await (timeoutMs === undefined
        ? read()
        : withTimeout(read(), timeoutMs)),
    };
  } catch (error) {
    // The Riot caller logs and counts these; evidence readers pass the same
    // statuses as expected absence so they are never reported as bugs.
    const absence =
      source === "RIOT" && evidenceRecoveryEnabled()
        ? riotSourceAbsence(error)
        : undefined;
    if (absence !== undefined) return { kind: "absent", absence };
    const deadlineExpired =
      timeoutMs !== undefined &&
      error instanceof Error &&
      error.message === `API request timed out after ${timeoutMs.toString()}ms`;
    if (!deadlineExpired && !isExpectedSourceReadError(error)) throw error;
    Sentry.captureException(error, {
      tags: { source: "evidence-acquisition", evidenceSource: source },
    });
    return { kind: "failed" };
  }
}

/** `readSource` for callers that only need the value. */
export async function optionalSourceRead<T>(
  source: MatchDataSource,
  read: () => Promise<T>,
  timeoutMs?: number,
): Promise<T | undefined> {
  const result = await readSource(source, read, timeoutMs);
  return result.kind === "read" ? result.value : undefined;
}
