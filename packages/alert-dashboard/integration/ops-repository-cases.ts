import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import type { DigestRunKey } from "#application/ports";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import {
  input,
  nanoseconds,
  opsRepository,
  repository,
  webhook,
} from "./sqlite-fixture.ts";

function storeAt(generatedAt: string) {
  const body = fixtureOpsIngest(generatedAt);
  const generatedAtNs = nanoseconds(generatedAt);
  return opsRepository.storeSnapshot({
    snapshot: body.snapshot,
    generatedAtNs,
    receivedAtNs: generatedAtNs,
    changes: body.changes.map((change) => ({
      ...change,
      occurredAtNs: nanoseconds(change.occurredAt),
    })),
    retentionDays: 90,
  });
}

const DAILY: DigestRunKey = {
  kind: "daily",
  periodKey: "2026-09-24",
  messageId: "<ops-digest-daily-2026-09-24@sjer.red>",
};

/** SQLite cases for the ops repository; registered by the integration suite. */
export function registerOpsRepositoryCases(): void {
  describe("SQLite ops repository", () => {
    it("keeps hourly samples plus the latest and upserts changes once", async () => {
      const start = Temporal.Instant.from("2026-09-24T10:00:00Z");
      let pruned = 0;
      for (let index = 0; index < 14; index += 1) {
        const result = await storeAt(
          start.add({ minutes: index * 5 }).toString(),
        );
        pruned += result.pruned;
      }
      const rows = await opsRepository.snapshotAtOrBefore(
        nanoseconds("2026-09-24T10:59:59Z"),
      );
      expect(rows?.generatedAtNs).toBe(nanoseconds("2026-09-24T10:00:00Z"));
      const latest = await opsRepository.latestSnapshot();
      expect(latest?.generatedAtNs).toBe(nanoseconds("2026-09-24T11:05:00Z"));
      expect(latest?.snapshot.schemaVersion).toBe(1);
      // 14 snapshots across 10:00-11:05 keep 10:00, 11:00, and 11:05.
      expect(pruned).toBe(11);
      const changes = await opsRepository.listChanges({ limit: 100 });
      expect(changes).toHaveLength(3);
      expect(
        await opsRepository.countChanges({
          kind: "deploy",
          sinceNs: 0n,
          untilNs: nanoseconds("2027-01-01T00:00:00Z"),
        }),
      ).toBe(1);
    });

    it("round-trips cursors", async () => {
      expect(await opsRepository.getCursor("web")).toBeNull();
      await opsRepository.putCursor({
        consumer: "web",
        lastSeenAtNs: 1n,
        seenSignalIds: ["a", "b"],
      });
      await opsRepository.putCursor({
        consumer: "web",
        lastSeenAtNs: 2n,
        seenSignalIds: ["c"],
      });
      expect(await opsRepository.getCursor("web")).toEqual({
        consumer: "web",
        lastSeenAtNs: 2n,
        seenSignalIds: ["c"],
      });
    });

    it("claims a digest period once and reclaims only failed or stale sends", async () => {
      expect(await opsRepository.claimDigestRun(DAILY, 100n, 0n)).toEqual({
        outcome: "claimed",
      });
      expect(await opsRepository.claimDigestRun(DAILY, 110n, 50n)).toEqual({
        outcome: "busy",
      });
      expect(await opsRepository.claimDigestRun(DAILY, 500n, 200n)).toEqual({
        outcome: "claimed",
      });
      await opsRepository.markDigestFailed(DAILY, "Postal returned 500");
      expect(await opsRepository.claimDigestRun(DAILY, 510n, 400n)).toEqual({
        outcome: "claimed",
      });
      await opsRepository.markDigestSent(DAILY, {
        sentAtNs: 520n,
        subject: "digest",
      });
      expect(await opsRepository.claimDigestRun(DAILY, 600n, 0n)).toEqual({
        outcome: "done",
        status: "sent",
      });
      expect(await opsRepository.recordDigestSkip(DAILY, 700n)).toEqual({
        created: false,
        status: "sent",
      });
      const weekly = { ...DAILY, kind: "weekly" as const, messageId: "<w@x>" };
      expect(await opsRepository.recordDigestSkip(weekly, 700n)).toEqual({
        created: true,
        status: "skipped",
      });
    });

    it("derives alert changes and incident stats from the ledger", async () => {
      await repository.ingestWebhook(
        input(webhook("fingerprint-ops", "firing"), "2026-08-08T18:00:01Z"),
      );
      await repository.ingestWebhook(
        input(webhook("fingerprint-ops", "resolved"), "2026-08-08T18:10:01Z"),
      );
      const changes = await opsRepository.alertChanges({
        namespaces: ["storage"],
        limit: 10,
      });
      expect(changes.map((change) => change.type)).toEqual([
        "resolved",
        "opened",
      ]);
      expect(
        await opsRepository.alertChanges({ namespaces: ["other"], limit: 10 }),
      ).toEqual([]);
      const stats = await opsRepository.incidentStats({
        sinceNs: nanoseconds("2026-08-08T00:00:00Z"),
        untilNs: nanoseconds("2026-08-09T00:00:00Z"),
      });
      expect(stats.opened).toBe(1);
      expect(stats.resolveDurationsNs).toHaveLength(1);
    });
  });
}
