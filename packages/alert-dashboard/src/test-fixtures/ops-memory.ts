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
  StoredOpsSnapshot,
  ViewerCursorRecord,
} from "#application/ports";
import type { AlertLedgerChange } from "#domain/ops-changes";
import { prunableSnapshotIds } from "#domain/ops-retention";
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

/** An `OpsRepository` with the same semantics as the Prisma one, in memory. */
export class InMemoryOpsRepository implements OpsRepository {
  readonly snapshots: StoredOpsSnapshot[] = [];
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

  recordDigestSkip(
    key: DigestRunKey,
  ): Promise<{ created: boolean; status: "sent" | "skipped" | "pending" }> {
    const id = `${key.kind}:${key.periodKey}`;
    const existing = this.digests.get(id);
    if (existing === undefined) {
      this.digests.set(id, {
        status: "skipped",
        claimedAtNs: null,
        attempts: 0,
      });
      return Promise.resolve({ created: true, status: "skipped" });
    }
    return Promise.resolve({
      created: false,
      status:
        existing.status === "sent" || existing.status === "skipped"
          ? existing.status
          : "pending",
    });
  }

  claimDigestRun(
    key: DigestRunKey,
    nowNs: bigint,
    staleBeforeNs: bigint,
  ): Promise<DigestClaim> {
    const id = `${key.kind}:${key.periodKey}`;
    const existing = this.digests.get(id);
    if (existing?.status === "sent" || existing?.status === "skipped")
      return Promise.resolve({ outcome: "done", status: existing.status });
    if (
      existing?.status === "sending" &&
      existing.claimedAtNs !== null &&
      existing.claimedAtNs > staleBeforeNs
    )
      return Promise.resolve({ outcome: "busy" });
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
    if (existing === undefined) throw new Error(`No digest run ${id}`);
    this.digests.set(id, { ...existing, status });
  }
}

/** Deterministic, smooth series so charts render the same on every run. */
export class FixtureSeries implements SeriesPort {
  readonly requests: SeriesRangeRequest[] = [];

  range(request: SeriesRangeRequest) {
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
    const ratio =
      request.promql.includes("ratio") || request.promql.startsWith("1 -");
    return Promise.resolve(
      names.map((name, index) => ({
        metric: { [label]: name, series: `${name} weekly` },
        points: Array.from(
          { length: count + 1 },
          (_, step): [number, number] => {
            const wave = Math.sin((step + index * 7) / 6) * 0.5 + 0.5;
            const value = ratio
              ? 0.2 + wave * 0.5
              : Math.round((index + 1) * 3 + wave * 5 * (index + 1));
            return [request.startSeconds + step * request.stepSeconds, value];
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

  send(input: PostalMessage): Promise<void> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith);
    this.sent.push(input);
    return Promise.resolve();
  }
}
