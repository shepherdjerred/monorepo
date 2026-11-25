import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import type { DigestRunKey } from "#application/ports";
import { DigestReportSchema } from "#shared/ops-schema";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { fixtureReportIngestBatch } from "#test-fixtures/reports-fixture";
import { AlertmanagerWebhookSchema } from "#shared/schema";
import {
  input,
  nanoseconds,
  opsRepository,
  reportRepository,
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
      await opsRepository.markDigestFailed(DAILY, "Mail API returned 500");
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
    });

    it("derives alert changes and incident stats from the ledger", async () => {
      await repository.ingestWebhook(
        input(webhook("fingerprint-ops", "firing"), "2026-08-08T18:00:01Z"),
      );
      await repository.ingestWebhook(
        input(webhook("fingerprint-ops", "resolved"), "2026-08-08T18:10:01Z"),
      );
      const houseBase = webhook("fingerprint-house-chore", "firing");
      const houseWebhook = AlertmanagerWebhookSchema.parse({
        ...houseBase,
        alerts: houseBase.alerts.map((entry) => ({
          ...entry,
          labels: {
            alertname: "RoborockConsumableDue",
            category: "household",
            severity: "warning",
            service: "roborock",
          },
        })),
      });
      await repository.ingestWebhook(
        input(houseWebhook, "2026-08-08T18:05:01Z", false),
      );
      const houseResolved = AlertmanagerWebhookSchema.parse({
        ...houseWebhook,
        status: "resolved",
        alerts: houseWebhook.alerts.map((entry) => ({
          ...entry,
          status: "resolved",
          endsAt: "2026-08-08T18:15:00Z",
        })),
      });
      await repository.ingestWebhook(
        input(houseResolved, "2026-08-08T18:15:01Z", false),
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

    it("persists ReportRun batches, DigestRun archives, and EmailOutbox Hub deep links in SQLite", async () => {
      const now = Temporal.Instant.from("2026-11-22T18:00:00Z");
      const batch = fixtureReportIngestBatch(now);
      expect(
        await reportRepository.upsertReportRuns(
          batch.items,
          now.epochNanoseconds,
        ),
      ).toEqual({ accepted: batch.items.length });

      // Upsert update preserves htmlBody when omitted on a subsequent status update.
      const firstItem = batch.items[0];
      if (firstItem === undefined) throw new Error("expected fixture item");
      await reportRepository.upsertReportRuns(
        [{ ...firstItem, htmlBody: "<!DOCTYPE html><p>stored</p>" }],
        now.epochNanoseconds + 1n,
      );
      await reportRepository.upsertReportRuns(
        [firstItem],
        now.epochNanoseconds + 2n,
      );
      const fetchedRun = await reportRepository.getReportRun(
        firstItem.report.reportRunId,
      );
      expect(fetchedRun?.htmlBody).toBe("<!DOCTYPE html><p>stored</p>");

      const latestPerSchedule =
        await reportRepository.listLatestRunsPerSchedule([
          "link-rot-scan-weekly",
          "main-vuln-scan-weekly",
        ]);
      expect(latestPerSchedule.size).toBe(2);

      // DigestRun rich archive + previousCompletedDailyDigest
      const day1: DigestRunKey = {
        kind: "daily",
        periodKey: "2026-11-20",
        messageId: "<ops-digest-daily-2026-11-20@sjer.red>",
      };
      const day2: DigestRunKey = {
        kind: "daily",
        periodKey: "2026-11-21",
        messageId: "<ops-digest-daily-2026-11-21@sjer.red>",
      };
      const sampleDigestReport = DigestReportSchema.parse({
        kind: "daily",
        periodKey: "2026-11-20",
        periodStart: "2026-11-19T15:30:00Z",
        periodEnd: "2026-11-20T15:30:00Z",
        status: {
          severity: "ok",
          summary: "All clear",
          stale: false,
          snapshotGeneratedAt: "2026-11-20T15:28:00Z",
        },
        attention: [],
        needsMe: [],
        newSinceLast: [],
        changes: [],
        incidents: { opened: 0, resolved: 0, medianMinutesToResolve: null },
        trends: [],
      });
      await opsRepository.claimDigestRun(day1, 1000n, 0n);
      await opsRepository.markDigestSent(day1, {
        sentAtNs: 1010n,
        subject: "Daily digest: All clear (Nov 20)",
        severity: "ok",
        summary: "All clear",
        needsMeCount: 0,
        attentionCount: 0,
        reportPayload: sampleDigestReport,
        htmlBody: "<p>clear</p>",
        plainBody: "clear\n",
      });
      expect(
        await opsRepository.previousCompletedDailyDigest("2026-11-21"),
      ).toEqual({
        periodKey: "2026-11-20",
        status: "sent",
        severity: "ok",
        needsMeCount: 0,
        attentionCount: 0,
      });

      await opsRepository.claimDigestRun(day2, 2000n, 0n);
      await opsRepository.markDigestSkipped(day2, {
        skipReason: "unchanged-clear",
        subject: "Daily digest: All clear (Nov 21)",
        severity: "ok",
        summary: "All clear",
        needsMeCount: 0,
        attentionCount: 0,
        reportPayload: { ...sampleDigestReport, periodKey: "2026-11-21" },
        htmlBody: "<p>clear 2</p>",
        plainBody: "clear 2\n",
      });
      const storedSkipped = await reportRepository.getDigestRun(
        "daily",
        "2026-11-21",
      );
      expect(storedSkipped?.status).toBe("skipped");
      expect(storedSkipped?.skipReason).toBe("unchanged-clear");

      // EmailOutbox incident mail + Hub deep link verification
      await repository.ingestWebhook(
        input(
          webhook("fingerprint-mail-hub-link", "firing"),
          "2026-11-22T17:00:00Z",
          true,
        ),
      );
      const mails = await reportRepository.listIncidentMails({ limit: 10 });
      expect(mails).toHaveLength(1);
      const mail = mails[0];
      if (mail === undefined) throw new Error("expected queued incident mail");
      expect(mail.htmlBody).toContain(`/reports/mail/${mail.id}`);
      expect(mail.plainBody).toContain(
        `View mail in Hub: https://hub.tailnet-1a49.ts.net/reports/mail/${mail.id}`,
      );
      const mailDetail = await reportRepository.getIncidentMail(mail.id);
      expect(mailDetail?.occurrences).toHaveLength(1);
      expect(await reportRepository.incidentOutboxCounts()).toEqual({
        pending: 1,
        failed: 0,
      });
    });
  });
}
