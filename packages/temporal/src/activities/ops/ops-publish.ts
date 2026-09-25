import { assembleSnapshot } from "@shepherdjerred/ops-model/assemble.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import {
  OpsIngestSchema,
  SOURCE_IDS,
  type ChangeEventInput,
  type OpsIngest,
  type SignalInput,
  type SourceId,
  type SourceStatus,
} from "@shepherdjerred/ops-model/snapshot.ts";
import {
  opsSnapshotPublishedTimestampSeconds,
  opsSnapshotSourceLastSuccessTimestampSeconds,
} from "#observability/metrics-ops.ts";
import { redactSecrets } from "#shared/redact.ts";
import {
  truncate,
  type OpsSourceResult,
  type SectionMetric,
} from "./ops-types.ts";

/** How one source's collection ended, as the workflow observed it. */
export type OpsCollectorOutcome =
  | { source: SourceId; ok: true; result: OpsSourceResult }
  | { source: SourceId; ok: false; error: string };

export type OpsPublishSummary = {
  generatedAt: string;
  severity: Severity;
  summary: string;
  failedSources: SourceId[];
  signals: number;
  changes: number;
};

export type OpsDigestKind = "daily" | "weekly";

/** POSTs a JSON body with a bearer token; injectable for tests. */
export type OpsPoster = (input: {
  url: string;
  token: string;
  body: unknown;
}) => Promise<void>;

export const postJson: OpsPoster = async ({ url, token, body }) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const text = await response.text();
    const detail = truncate(text.trim(), 300);
    throw new Error(
      `POST ${new URL(url).pathname} returned HTTP ${String(response.status)}${detail === "" ? "" : `: ${detail}`}`,
    );
  }
  await response.body?.cancel();
};

/** A failure reason safe to store in a snapshot: bounded and secret-free. */
export function redactFailure(
  message: string,
  secrets: readonly (string | undefined)[],
): string {
  return truncate(
    redactSecrets(message, secrets).replaceAll(/\s+/gu, " "),
    300,
  );
}

/** Keep the first of each `(source, externalId)` pair. */
export function dedupeChanges(
  changes: readonly ChangeEventInput[],
): ChangeEventInput[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    const key = `${change.source}\u{0}${change.externalId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Turn per-source outcomes into a validated ingest payload. Every source
 * must report exactly once; a missing or doubled source is a broken
 * workflow contract, not a data problem.
 */
export function buildOpsIngest(input: {
  outcomes: readonly OpsCollectorOutcome[];
  now: Date;
  lastSuccess: ReadonlyMap<SourceId, string>;
  secrets: readonly (string | undefined)[];
}): OpsIngest {
  const reported = input.outcomes.map((outcome) => outcome.source);
  const expected = [...SOURCE_IDS].toSorted();
  if (reported.toSorted().join(",") !== expected.join(",")) {
    throw new Error(
      `Ops snapshot outcomes must cover each source once; got ${reported.join(", ")}`,
    );
  }
  const observedAt = input.now.toISOString();
  const statuses: SourceStatus[] = [];
  const signals: SignalInput[] = [];
  const metrics: SectionMetric[] = [];
  const changes: ChangeEventInput[] = [];
  for (const outcome of input.outcomes) {
    if (outcome.ok) {
      statuses.push({
        ...outcome.result.status,
        lastSuccessAt: outcome.result.status.observedAt,
      });
      signals.push(...outcome.result.signals);
      metrics.push(...outcome.result.metrics);
      changes.push(...outcome.result.changes);
      continue;
    }
    const lastSuccessAt = input.lastSuccess.get(outcome.source);
    statuses.push({
      source: outcome.source,
      ok: false,
      observedAt,
      durationMs: 0,
      error: redactFailure(outcome.error, input.secrets),
      ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
    });
  }
  const snapshot = assembleSnapshot({
    generatedAt: input.now,
    sources: statuses,
    signals,
    metrics,
  });
  return OpsIngestSchema.parse({ snapshot, changes: dedupeChanges(changes) });
}

/** Record successful sources so later failures can report their last success. */
export function recordSourceSuccesses(
  outcomes: readonly OpsCollectorOutcome[],
  lastSuccess: Map<SourceId, string>,
): void {
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      continue;
    }
    const observedAt = outcome.result.status.observedAt;
    lastSuccess.set(outcome.source, observedAt);
    opsSnapshotSourceLastSuccessTimestampSeconds.set(
      { source: outcome.source },
      Math.floor(Date.parse(observedAt) / 1000),
    );
  }
}

export async function publishOpsIngest(input: {
  ingest: OpsIngest;
  dashboardUrl: string;
  token: string;
  post: OpsPoster;
}): Promise<OpsPublishSummary> {
  await input.post({
    url: new URL("/internal/v1/ops/snapshots", input.dashboardUrl).toString(),
    token: input.token,
    body: input.ingest,
  });
  const { snapshot, changes } = input.ingest;
  opsSnapshotPublishedTimestampSeconds.set(
    Math.floor(Date.parse(snapshot.generatedAt) / 1000),
  );
  return {
    generatedAt: snapshot.generatedAt,
    severity: snapshot.severity,
    summary: snapshot.summary,
    failedSources: snapshot.sources
      .filter((status) => !status.ok)
      .map((status) => status.source),
    signals: snapshot.sections.reduce(
      (total, section) => total + section.signals.length,
      0,
    ),
    changes: changes.length,
  };
}

export async function triggerDigest(input: {
  kind: OpsDigestKind;
  dashboardUrl: string;
  token: string;
  post: OpsPoster;
}): Promise<{ kind: OpsDigestKind }> {
  await input.post({
    url: new URL(
      `/internal/v1/digests/${input.kind}`,
      input.dashboardUrl,
    ).toString(),
    token: input.token,
    body: undefined,
  });
  return { kind: input.kind };
}
