import {
  FACET_KEYS,
  FACET_SCHEMAS,
  OpsFacetsSchema,
  type FacetByKey,
  type FacetKey,
  type OpsFacets,
} from "@shepherdjerred/ops-model/facets.ts";

import type {
  AlertChangeQuery,
  ChangeQuery,
  DigestClaim,
  DigestRunKey,
  IncidentWindowStats,
  OpsRepository,
  PostalMessage,
  PostalPort,
  SeriesPort,
  SeriesRangeRequest,
  StoreOpsSnapshotInput,
  StoreOpsSnapshotResult,
  StoredOpsFacet,
  StoredOpsSnapshot,
  ViewerCursorRecord,
} from "#application/ports";
import type { AlertLedgerChange } from "#domain/ops-changes";
import { prunableSnapshotIds, retentionCutoffNs } from "#domain/ops-retention";
import {
  ChangeViewSchema,
  type ChangeView,
  type CursorConsumer,
} from "#shared/ops-schema";
import { epochNanosecondsToInstantText } from "#shared/time";

type DigestRow = {
  status: "sending" | "sent" | "failed" | "skipped";
  claimedAtNs: bigint | null;
  attempts: number;
};

type StoredChange = ChangeView & { occurredAtNs: bigint };

type StoredFacetEntry = {
  generatedAtNs: bigint;
  receivedAtNs: bigint;
  data: unknown;
};

function inRange(
  value: bigint,
  sinceNs: bigint | undefined,
  untilNs: bigint | undefined,
): boolean {
  return (
    (sinceNs === undefined || value >= sinceNs) &&
    (untilNs === undefined || value < untilNs)
  );
}

const FACET_SCHEMA_BY_KEY: {
  readonly [K in FacetKey]: { parse: (input: unknown) => FacetByKey[K] };
} = FACET_SCHEMAS;

function parseFacetPayload<K extends FacetKey>(
  key: K,
  payload: unknown,
): FacetByKey[K] {
  return FACET_SCHEMA_BY_KEY[key].parse(payload);
}

/** An `OpsRepository` with the same semantics as the Prisma one, in memory. */
export class InMemoryOpsRepository implements OpsRepository {
  readonly snapshots: StoredOpsSnapshot[] = [];
  readonly facets = new Map<FacetKey, StoredFacetEntry>();
  readonly changes = new Map<string, StoredChange>();
  readonly cursors = new Map<CursorConsumer, ViewerCursorRecord>();
  readonly digests = new Map<string, DigestRow>();
  alertLedger: AlertLedgerChange[] = [];
  incidents: IncidentWindowStats = { opened: 0, resolveDurationsNs: [] };
  #sequence = 0;

  storeSnapshot(input: StoreOpsSnapshotInput): Promise<StoreOpsSnapshotResult> {
    this.#sequence += 1;
    const snapshotId = `snapshot-${String(this.#sequence).padStart(6, "0")}`;
    this.snapshots.push({
      id: snapshotId,
      generatedAtNs: input.generatedAtNs,
      receivedAtNs: input.receivedAtNs,
      snapshot: input.snapshot,
    });
    if (input.facets !== undefined) {
      for (const key of FACET_KEYS) {
        const value = input.facets[key];
        if (value !== undefined) {
          this.facets.set(key, {
            generatedAtNs: input.generatedAtNs,
            receivedAtNs: input.receivedAtNs,
            data: value,
          });
        }
      }
    }
    for (const change of input.changes) {
      const key = `${change.source}\0${change.externalId}`;
      const existing = this.changes.get(key);
      const { occurredAtNs, ...event } = change;
      this.changes.set(key, {
        ...ChangeViewSchema.parse({
          ...event,
          id: existing?.id ?? `change-${key}`,
          occurredAt: epochNanosecondsToInstantText(occurredAtNs),
        }),
        occurredAtNs,
      });
    }
    const cutoffNs = retentionCutoffNs(input.receivedAtNs, input.retentionDays);
    for (const [key, change] of this.changes) {
      if (change.occurredAtNs < cutoffNs) {
        this.changes.delete(key);
      }
    }
    const prunable = new Set(
      prunableSnapshotIds(
        this.snapshots,
        input.receivedAtNs,
        input.retentionDays,
      ),
    );
    const before = this.snapshots.length;
    this.snapshots.splice(
      0,
      this.snapshots.length,
      ...this.snapshots.filter((row) => !prunable.has(row.id)),
    );
    return Promise.resolve({
      snapshotId,
      changesUpserted: input.changes.length,
      pruned: before - this.snapshots.length,
    });
  }

  latestSnapshot(): Promise<StoredOpsSnapshot | null> {
    return this.snapshotAtOrBefore(
      BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000_000n,
    );
  }

  async latestSnapshotReceivedAtNs(): Promise<bigint | null> {
    const latest = await this.latestSnapshot();
    return latest?.receivedAtNs ?? null;
  }

  snapshotAtOrBefore(targetNs: bigint): Promise<StoredOpsSnapshot | null> {
    const candidates = this.snapshots
      .filter((row) => row.generatedAtNs <= targetNs)
      .toSorted((left, right) =>
        left.generatedAtNs === right.generatedAtNs
          ? right.id.localeCompare(left.id)
          : left.generatedAtNs > right.generatedAtNs
            ? -1
            : 1,
      );
    return Promise.resolve(candidates[0] ?? null);
  }

  getFacet<K extends FacetKey>(key: K): Promise<StoredOpsFacet<K> | null> {
    const entry = this.facets.get(key);
    if (entry === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      key,
      generatedAtNs: entry.generatedAtNs,
      receivedAtNs: entry.receivedAtNs,
      data: parseFacetPayload(key, entry.data),
    });
  }

  getAllFacets(): Promise<{
    facets: OpsFacets;
    receivedAtNs: bigint | null;
    generatedAtNs: bigint | null;
  }> {
    const entries: Record<string, unknown> = {};
    let receivedAtNs: bigint | null = null;
    let generatedAtNs: bigint | null = null;
    for (const [key, entry] of this.facets) {
      entries[key] = entry.data;
      if (receivedAtNs === null || entry.receivedAtNs > receivedAtNs) {
        receivedAtNs = entry.receivedAtNs;
      }
      if (generatedAtNs === null || entry.generatedAtNs > generatedAtNs) {
        generatedAtNs = entry.generatedAtNs;
      }
    }
    return Promise.resolve({
      facets: OpsFacetsSchema.parse(entries),
      receivedAtNs,
      generatedAtNs,
    });
  }

  listChanges(query: ChangeQuery): Promise<ChangeView[]> {
    return Promise.resolve(
      [...this.changes.values()]
        .filter(
          (change) =>
            (query.service === undefined || change.service === query.service) &&
            inRange(change.occurredAtNs, query.sinceNs, query.untilNs),
        )
        .toSorted((left, right) =>
          left.occurredAtNs > right.occurredAtNs ? -1 : 1,
        )
        .slice(0, query.limit)
        .map(({ occurredAtNs: _occurredAtNs, ...change }) => change),
    );
  }

  countChanges(input: {
    kind: ChangeView["kind"];
    sinceNs: bigint;
    untilNs: bigint;
  }): Promise<number> {
    return Promise.resolve(
      [...this.changes.values()].filter(
        (change) =>
          change.kind === input.kind &&
          inRange(change.occurredAtNs, input.sinceNs, input.untilNs),
      ).length,
    );
  }

  alertChanges(query: AlertChangeQuery): Promise<AlertLedgerChange[]> {
    return Promise.resolve(
      this.alertLedger
        .filter(
          (change) =>
            (query.namespaces === undefined ||
              (change.namespace !== null &&
                query.namespaces.includes(change.namespace))) &&
            inRange(change.occurredAtNs, query.sinceNs, query.untilNs),
        )
        .slice(0, query.limit),
    );
  }

  incidentStats(): Promise<IncidentWindowStats> {
    return Promise.resolve(this.incidents);
  }

  getCursor(consumer: CursorConsumer): Promise<ViewerCursorRecord | null> {
    return Promise.resolve(this.cursors.get(consumer) ?? null);
  }

  putCursor(record: ViewerCursorRecord): Promise<void> {
    this.cursors.set(record.consumer, record);
    return Promise.resolve();
  }

  claimDigestRun(
    key: DigestRunKey,
    nowNs: bigint,
    staleBeforeNs: bigint,
  ): Promise<DigestClaim> {
    const id = `${key.kind}:${key.periodKey}`;
    const existing = this.digests.get(id);
    if (existing?.status === "sent" || existing?.status === "skipped") {
      return Promise.resolve({ outcome: "done", status: existing.status });
    }
    if (
      existing?.status === "sending" &&
      existing.claimedAtNs !== null &&
      existing.claimedAtNs > staleBeforeNs
    ) {
      return Promise.resolve({ outcome: "busy" });
    }
    this.digests.set(id, {
      status: "sending",
      claimedAtNs: nowNs,
      attempts: (existing?.attempts ?? 0) + 1,
    });
    return Promise.resolve({ outcome: "claimed" });
  }

  markDigestSent(key: DigestRunKey): Promise<void> {
    this.#setStatus(key, "sent");
    return Promise.resolve();
  }

  markDigestFailed(key: DigestRunKey): Promise<void> {
    this.#setStatus(key, "failed");
    return Promise.resolve();
  }

  #setStatus(key: DigestRunKey, status: DigestRow["status"]): void {
    const id = `${key.kind}:${key.periodKey}`;
    const existing = this.digests.get(id);
    if (existing === undefined) {
      throw new Error(`No digest run ${id}`);
    }
    this.digests.set(id, { ...existing, status });
  }
}

function sampleSeriesValue(
  promql: string,
  index: number,
  wave: number,
): number {
  if (
    promql.includes("ratio") ||
    promql.includes("clamp_min(") ||
    promql.startsWith("1 -") ||
    promql.includes("(1 - ") ||
    promql.includes("arc_hits") ||
    promql.includes("STATUS_CODE_ERROR")
  ) {
    return 0.2 + wave * 0.5;
  }
  if (promql.includes("celsius")) {
    return Math.round((42 + index * 4 + wave * 16) * 10) / 10;
  }
  if (
    (promql.includes("_bytes") && promql.includes("rate(")) ||
    promql.includes("_speed_bytes")
  ) {
    return Math.round((index + 1) * 524_288 * (0.4 + wave * 1.2));
  }
  if (promql.includes("_bytes")) {
    return Math.round((index + 1) * 4 * 1024 ** 3 * (0.7 + wave * 0.6));
  }
  if (promql.includes("1000 *") || promql.includes("_ms")) {
    return Math.round(80 + index * 35 + wave * 140);
  }
  if (promql.includes("sessions_count")) {
    return Math.round((1.2 + index * 0.8 + wave * 3.2) * 10) / 10;
  }
  if (
    promql.includes("_seconds") ||
    promql.includes("time() -") ||
    promql.includes("/ 1e9")
  ) {
    return Math.round((index + 1) * 120 + wave * 600);
  }
  return promql.includes("percent")
    ? Math.round(25 + index * 10 + wave * 45)
    : Math.round((index + 1) * 3 + wave * 5 * (index + 1));
}

/** Deterministic, smooth series so charts render the same on every run. */
export class FixtureSeries implements SeriesPort {
  readonly requests: SeriesRangeRequest[] = [];

  range(request: SeriesRangeRequest, _signal?: AbortSignal) {
    this.requests.push(request);
    const names = request.promql.includes("by (source)")
      ? ["claude-code", "codex", "cursor"]
      : request.promql.includes("by (instance)")
        ? ["node-1"]
        : request.promql.includes("by (")
          ? ["alpha", "beta"]
          : ["total"];
    const label = /by \((\w+)/u.exec(request.promql)?.[1] ?? "series";
    const count = Math.floor(
      (request.endSeconds - request.startSeconds) / request.stepSeconds,
    );
    return Promise.resolve(
      names.map((name, index) => ({
        metric: { [label]: name, series: `${name} weekly` },
        points: Array.from(
          { length: count + 1 },
          (_, step): [number, number] => {
            const wave = Math.sin((step + index * 7) / 6) * 0.5 + 0.5;
            return [
              request.startSeconds + step * request.stepSeconds,
              sampleSeriesValue(request.promql, index, wave),
            ];
          },
        ),
      })),
    );
  }

  scalar(promql: string): Promise<number | null> {
    return Promise.resolve(promql.includes("offset") ? 18.5 : 24.25);
  }
}

export class RecordingPostal implements PostalPort {
  readonly sent: PostalMessage[] = [];
  failWith: Error | undefined;

  async send(input: PostalMessage): Promise<void> {
    if (this.failWith !== undefined) {
      throw this.failWith;
    }
    this.sent.push(input);
    await Promise.resolve();
  }
}
