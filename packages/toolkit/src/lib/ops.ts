import { z } from "zod";
import { SnapshotResponseSchema } from "@shepherdjerred/ops-model/snapshot.ts";
import type { FreshSnapshot } from "@shepherdjerred/ops-model/assemble.ts";

/**
 * Client for the ops dashboard's snapshot API. The snapshot is the single
 * operational read model; toolkit renders it and never recomputes severity.
 */

export class OpsSnapshotError extends Error {
  override readonly name = "OpsSnapshotError";
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY_CHARS = 500;

export function opsSnapshotUrl(baseUrl: string): string {
  const url = new URL("/api/v1/ops/snapshot", baseUrl);
  return url.toString();
}

export async function fetchOpsSnapshot(
  baseUrl: string,
): Promise<FreshSnapshot> {
  const url = opsSnapshotUrl(baseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OpsSnapshotError(
      `Could not reach the ops dashboard at ${url}: ${message}`,
      { cause: error },
    );
  }
  const body = await response.text();
  if (response.status !== 200) {
    throw new OpsSnapshotError(
      `Ops dashboard returned HTTP ${String(response.status)} for ${url}: ${body.slice(0, MAX_ERROR_BODY_CHARS)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error: unknown) {
    throw new OpsSnapshotError(`Ops dashboard returned non-JSON from ${url}`, {
      cause: error,
    });
  }
  const parsed = SnapshotResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new OpsSnapshotError(
      `Ops snapshot response from ${url} does not match the ops-model contract:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const snapshot = parsed.data;
  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    severity: snapshot.severity,
    summary: snapshot.summary,
    sources: snapshot.sources,
    sections: snapshot.sections,
    stale: snapshot.stale,
    ageMs: snapshot.ageMs,
  };
}
