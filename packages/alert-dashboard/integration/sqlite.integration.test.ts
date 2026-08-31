import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AlertmanagerSnapshotAlertSchema,
  AlertmanagerWebhookSchema,
} from "#shared/schema";
import { epochNanosecondsToInstantText, InstantTextSchema } from "#shared/time";
import {
  disconnectDatabase,
  IndexRowSchema,
  input,
  nanoseconds,
  prisma,
  repository,
  resetDatabase,
  temporalFailureWebhook,
  waitForDatabase,
  webhook,
} from "./sqlite-fixture.ts";
import {
  keepsStaleResolutionOnPriorOccurrence,
  matchesRefreshedResolution,
} from "./webhook-authority-cases.ts";

async function expectNormalizedIndexes(): Promise<void> {
  const indexes = IndexRowSchema.parse(
    await prisma.$queryRaw`
      SELECT name AS indexname
      FROM sqlite_master
      WHERE type = 'index'
        AND (
          tbl_name = 'AlertOccurrenceLabel' OR
          tbl_name = 'WebhookDeliveryOccurrence'
        )
    `,
  );
  expect(indexes.map((row) => row.indexname)).toContain(
    "AlertOccurrenceLabel_key_value_occurrenceId_idx",
  );
  expect(indexes.map((row) => row.indexname)).toContain(
    "WebhookDeliveryOccurrence_occurrenceId_deliveryId_idx",
  );
}

beforeAll(waitForDatabase);
beforeEach(resetDatabase);
afterAll(disconnectDatabase);

describe("SQLite email cancellation", () => {
  it("dry-runs and audits cancellation of only pending incident email", async () => {
    const incident = temporalFailureWebhook("fingerprint-temporal");
    await repository.ingestWebhook(input(incident, "2026-08-08T18:00:01Z"));
    await repository.ingestWebhook(
      input(webhook("fingerprint-unrelated", "firing"), "2026-08-08T18:00:02Z"),
    );
    const cancellation = {
      alertname: "TemporalWorkflowFailed",
      fromNs: nanoseconds("2026-08-08T18:00:00Z"),
      toNs: nanoseconds("2026-08-08T18:01:00Z"),
      canceledAtNs: nanoseconds("2026-08-08T18:02:00Z"),
      canceledBy: "incident-operator",
      reason: "Scout retry amplification incident",
    };

    expect(
      await repository.cancelPendingEmails({
        ...cancellation,
        confirm: false,
      }),
    ).toMatchObject({ matched: 1, canceled: 0 });
    expect(
      await repository.pendingEmails(nanoseconds("2026-08-08T18:03:00Z"), 10),
    ).toHaveLength(2);

    expect(
      await repository.cancelPendingEmails({
        ...cancellation,
        confirm: true,
      }),
    ).toMatchObject({ matched: 1, canceled: 1 });
    expect(
      await repository.pendingEmails(nanoseconds("2026-08-08T18:03:00Z"), 10),
    ).toHaveLength(1);
    const canceled = await prisma.emailOutbox.findFirstOrThrow({
      where: { canceledAtNs: { not: null } },
    });
    expect(canceled.canceledBy).toBe("incident-operator");
    expect(canceled.cancellationReason).toBe(
      "Scout retry amplification incident",
    );
  });

  it("does not cancel an email after the sender claims it", async () => {
    const incident = temporalFailureWebhook("fingerprint-claimed");
    await repository.ingestWebhook(input(incident, "2026-08-08T18:00:01Z"));
    const claimed = await repository.claimPendingEmails(
      nanoseconds("2026-08-08T18:01:00Z"),
      10,
      nanoseconds("2026-08-08T18:01:00Z"),
    );
    expect(claimed).toHaveLength(1);

    await expect(
      repository.cancelPendingEmails({
        alertname: "TemporalWorkflowFailed",
        fromNs: nanoseconds("2026-08-08T18:00:00Z"),
        toNs: nanoseconds("2026-08-08T18:01:00Z"),
        canceledAtNs: nanoseconds("2026-08-08T18:02:00Z"),
        canceledBy: "incident-operator",
        reason: "sender claim wins",
        confirm: true,
      }),
    ).resolves.toMatchObject({ matched: 0, canceled: 0 });
  });

  it("reclaims expired claims and rejects the stale sender", async () => {
    const incident = temporalFailureWebhook("fingerprint-reclaim");
    await repository.ingestWebhook(input(incident, "2026-08-08T18:00:01Z"));
    const first = await repository.claimPendingEmails(
      nanoseconds("2026-08-08T18:01:00Z"),
      10,
      nanoseconds("2026-08-08T18:01:00Z"),
    );
    const firstClaim = first[0];
    if (firstClaim === undefined) throw new Error("expected initial claim");
    await prisma.emailOutbox.update({
      where: { id: firstClaim.id },
      data: { sendingAtNs: nanoseconds("2026-08-08T17:54:00Z") },
    });

    const reclaimed = await repository.claimPendingEmails(
      nanoseconds("2026-08-08T18:06:00Z"),
      10,
      nanoseconds("2026-08-08T18:06:00Z"),
    );
    const reclaimedClaim = reclaimed[0];
    if (reclaimedClaim === undefined) throw new Error("expected reclaim");
    expect(reclaimedClaim.sendClaimId).not.toBe(firstClaim.sendClaimId);
    await expect(
      repository.markEmailSent({
        id: firstClaim.id,
        sendClaimId: firstClaim.sendClaimId,
        sentAtNs: nanoseconds("2026-08-08T18:00:01Z"),
      }),
    ).rejects.toThrow("Email send claim changed before success");
    await repository.markEmailSent({
      id: reclaimedClaim.id,
      sendClaimId: reclaimedClaim.sendClaimId,
      sentAtNs: nanoseconds("2026-08-08T18:00:02Z"),
    });
  });
});

describe("SQLite alert ledger", () => {
  it("serializes concurrent webhook retries into one lifecycle and one email", async () => {
    const delivery = input(
      webhook("fingerprint-concurrent", "firing"),
      "2026-08-08T18:00:01Z",
    );
    const results = await Promise.all([
      repository.ingestWebhook(delivery),
      repository.ingestWebhook(delivery),
    ]);
    expect(results.filter((result) => result.emailQueued)).toHaveLength(1);
    const summary = await repository.summary();
    expect(summary.open).toBe(1);
    expect(summary.warning).toBe(1);
    const alerts = await repository.listAlerts({ limit: 10 });
    const id = alerts.items[0]?.id;
    if (id === undefined) throw new Error("expected one occurrence");
    const detail = await repository.getAlert({ id, limit: 1 });
    expect(detail?.events.map((event) => event.type)).toEqual(["opened"]);
    expect(detail?.deliveries).toHaveLength(1);
    expect(detail?.deliveries[0]?.truncatedAlerts).toBe(0);
    expect(detail?.deliveriesNextCursor).not.toBeNull();
    if (detail === null) throw new Error("expected alert detail");
    if (detail.deliveriesNextCursor === null)
      throw new Error("expected a delivery evidence cursor");
    const olderEvidence = await repository.getAlert({
      id,
      cursor: detail.deliveriesNextCursor,
      limit: 1,
    });
    expect(olderEvidence?.deliveries).toHaveLength(1);
    expect(olderEvidence?.deliveries[0]?.id).not.toBe(detail.deliveries[0]?.id);
    expect(olderEvidence?.deliveriesNextCursor).toBeNull();
    expect(
      await repository.pendingEmails(nanoseconds("2026-08-08T18:01:00Z"), 10),
    ).toHaveLength(1);
  });

  it("persists Alertmanager truncation evidence on webhook deliveries", async () => {
    const payload = AlertmanagerWebhookSchema.parse({
      ...webhook("fingerprint-truncated", "firing"),
      truncatedAlerts: 37,
    });
    await repository.ingestWebhook(
      input(payload, "2026-08-08T18:00:01Z", true),
    );
    const alerts = await repository.listAlerts({ limit: 10 });
    const id = alerts.items[0]?.id;
    if (id === undefined) throw new Error("expected a truncated occurrence");

    const detail = await repository.getAlert({ id, limit: 10 });

    expect(detail?.deliveries[0]?.truncatedAlerts).toBe(37);
    await repository.ingestWebhook(
      input(payload, "2026-08-08T18:00:02Z", true),
    );
    const outbox = await prisma.emailOutbox.findMany({
      orderBy: { createdAtNs: "asc" },
      select: { occurrenceIds: true },
    });
    expect(outbox).toHaveLength(2);
    expect(outbox[1]?.occurrenceIds).toEqual([]);
  });

  it("serializes concurrent snapshot and webhook discovery", async () => {
    const snapshot = AlertmanagerSnapshotAlertSchema.parse({
      annotations: { summary: "Concurrent observation" },
      endsAt: "0001-01-01T00:00:00Z",
      fingerprint: "fingerprint-cross-source-concurrent",
      startsAt: "2026-08-08T18:00:00Z",
      generatorURL: "",
      labels: { alertname: "ConcurrentAlert", severity: "warning" },
      status: { inhibitedBy: [], silencedBy: [], state: "active" },
    });
    const observedAt = nanoseconds("2026-08-08T18:00:01Z");

    const [webhookResult, snapshotResult] = await Promise.all([
      repository.ingestWebhook(
        input(
          webhook(
            "fingerprint-cross-source-concurrent",
            "firing",
            "2026-08-08T18:00:00Z",
          ),
          "2026-08-08T18:00:01Z",
        ),
      ),
      repository.reconcileSnapshot({
        alerts: [snapshot],
        startedAtNs: observedAt,
        completedAtNs: observedAt,
        missingGraceNs: 300_000_000_000n,
      }),
    ]);

    expect(webhookResult.opened + snapshotResult.opened).toBe(1);
    const summary = await repository.summary();
    expect(summary.open).toBe(1);
    const alerts = await repository.listAlerts({ limit: 10 });
    expect(alerts.items).toHaveLength(1);
    const id = alerts.items[0]?.id;
    if (id === undefined) throw new Error("expected concurrent occurrence");
    const detail = await repository.getAlert({ id, limit: 10 });
    expect(detail?.events.map((event) => event.type)).toEqual(["opened"]);
    expect(detail?.deliveries).toHaveLength(1);
  });

  it("keeps refreshed start times in one open lifecycle", async () => {
    const fingerprint = "fingerprint-refreshed-start";
    await repository.ingestWebhook(
      input(
        webhook(fingerprint, "firing", "2026-08-08T18:00:00Z"),
        "2026-08-08T18:00:01Z",
      ),
    );
    await repository.ingestWebhook(
      input(
        webhook(fingerprint, "firing", "2026-08-08T18:05:00Z"),
        "2026-08-08T18:05:01Z",
      ),
    );
    const refreshedSnapshot = AlertmanagerSnapshotAlertSchema.parse({
      annotations: { summary: "Refreshed snapshot observation" },
      endsAt: "0001-01-01T00:00:00Z",
      fingerprint,
      startsAt: "2026-08-08T18:07:00Z",
      generatorURL: "",
      labels: { alertname: "DiskFull", severity: "warning" },
      status: {
        inhibitedBy: [],
        silencedBy: ["silence-refreshed-start"],
        state: "suppressed",
      },
    });
    await repository.reconcileSnapshot({
      alerts: [refreshedSnapshot],
      startedAtNs: nanoseconds("2026-08-08T18:07:01Z"),
      completedAtNs: nanoseconds("2026-08-08T18:07:01Z"),
      missingGraceNs: 300_000_000_000n,
    });
    const refreshed = await repository.listAlerts({ limit: 10 });
    expect(refreshed.items).toHaveLength(1);
    expect(refreshed.items[0]?.openedAt).toBe(
      InstantTextSchema.parse("2026-08-08T18:00:00Z"),
    );
    expect(refreshed.items[0]?.suppressionState).toBe("silenced");
    const suppressedSummary = await repository.summary();
    expect(suppressedSummary.warning).toBe(0);
    expect(suppressedSummary.silenced).toBe(1);
    await repository.ingestWebhook(
      input(
        webhook(fingerprint, "resolved", "2026-08-08T18:10:00Z"),
        "2026-08-08T18:10:01Z",
      ),
    );

    const resolved = await repository.listAlerts({ limit: 10 });
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]?.lifecycleState).toBe("resolved");
    expect(resolved.items[0]?.openedAt).toBe(
      InstantTextSchema.parse("2026-08-08T18:00:00Z"),
    );
    const resolvedId = resolved.items[0]?.id;
    if (resolvedId === undefined)
      throw new Error("expected resolved occurrence");
    const detail = await repository.getAlert({ id: resolvedId, limit: 10 });
    expect(detail?.deliveries).toHaveLength(3);

    await repository.ingestWebhook(
      input(
        webhook(fingerprint, "firing", "2026-08-08T19:00:00Z"),
        "2026-08-08T19:00:01Z",
      ),
    );
    const reopened = await repository.listAlerts({ limit: 10 });
    expect(reopened.items).toHaveLength(2);
    expect(
      reopened.items.filter(
        (occurrence) => occurrence.lifecycleState === "open",
      ),
    ).toHaveLength(1);
  });

  it("handles reordered resolve and fire deliveries without reopening or emailing", async () => {
    await repository.ingestWebhook(
      input(
        webhook("fingerprint-reordered", "resolved"),
        "2026-08-08T18:10:01Z",
      ),
    );
    const lateFire = await repository.ingestWebhook(
      input(webhook("fingerprint-reordered", "firing"), "2026-08-08T18:11:00Z"),
    );
    expect(lateFire.emailQueued).toBe(false);
    const alerts = await repository.listAlerts({ limit: 10 });
    expect(alerts.items[0]?.lifecycleState).toBe("resolved");
    expect(alerts.items[0]?.resolutionSource).toBe("webhook");
  });
});

describe("SQLite snapshot reconciliation", () => {
  it("serializes a firing webhook with an older snapshot absence pass", async () => {
    const fingerprint = "fingerprint-overlapping-absence";
    const alert = AlertmanagerSnapshotAlertSchema.parse({
      annotations: { summary: "Overlapping observation" },
      endsAt: "0001-01-01T00:00:00Z",
      fingerprint,
      startsAt: "2026-08-08T18:00:00Z",
      generatorURL: "",
      labels: { alertname: "OverlappingAlert", severity: "info" },
      status: { inhibitedBy: [], silencedBy: [], state: "active" },
    });
    const start = nanoseconds("2026-08-08T18:00:00Z");
    const minute = 60_000_000_000n;
    await repository.reconcileSnapshot({
      alerts: [alert],
      startedAtNs: start,
      completedAtNs: start,
      missingGraceNs: 5n * minute,
    });
    await repository.reconcileSnapshot({
      alerts: [],
      startedAtNs: start + minute,
      completedAtNs: start + minute,
      missingGraceNs: 5n * minute,
    });
    await Promise.all([
      repository.ingestWebhook(
        input(
          webhook(fingerprint, "firing", "2026-08-08T18:07:00Z", "info"),
          "2026-08-08T18:07:01Z",
        ),
      ),
      repository.reconcileSnapshot({
        alerts: [],
        startedAtNs: start + 6n * minute,
        completedAtNs: start + 8n * minute,
        missingGraceNs: 5n * minute,
      }),
    ]);

    const alerts = await repository.listAlerts({ limit: 10 });
    expect(alerts.items).toHaveLength(1);
    expect(alerts.items[0]?.lifecycleState).toBe("open");
    const id = alerts.items[0]?.id;
    if (id === undefined) throw new Error("expected overlapping occurrence");
    const detail = await repository.getAlert({ id, limit: 10 });
    const resolvedIndex =
      detail?.events.findIndex((event) => event.type === "resolved") ?? -1;
    if (resolvedIndex >= 0)
      expect(detail?.events.at(resolvedIndex + 1)).toMatchObject({
        type: "opened",
        source: "webhook",
      });
  });

  it("reconciles absences after the grace period and reopens only reconciled resolutions", async () => {
    const alert = AlertmanagerSnapshotAlertSchema.parse({
      annotations: { summary: "Short observation" },
      endsAt: "0001-01-01T00:00:00Z",
      fingerprint: "fingerprint-snapshot",
      startsAt: "2026-08-08T18:00:00Z",
      generatorURL: "",
      labels: { alertname: "SnapshotOnly", severity: "info" },
      status: { inhibitedBy: [], silencedBy: [], state: "active" },
    });
    const minute = 60_000_000_000n;
    const start = nanoseconds("2026-08-08T18:00:00Z");
    await repository.reconcileSnapshot({
      alerts: [alert],
      startedAtNs: start,
      completedAtNs: start,
      missingGraceNs: 5n * minute,
    });
    await repository.reconcileSnapshot({
      alerts: [],
      startedAtNs: start + minute,
      completedAtNs: start + minute,
      missingGraceNs: 5n * minute,
    });
    await repository.reconcileSnapshot({
      alerts: [],
      startedAtNs: start + 7n * minute,
      completedAtNs: start + 7n * minute,
      missingGraceNs: 5n * minute,
    });
    const alerts = await repository.listAlerts({ limit: 10 });
    expect(alerts.items[0]?.lifecycleState).toBe("resolved");
    expect(alerts.items[0]?.resolutionSource).toBe("reconciled");
    expect(
      await repository.pendingEmails(start + 8n * minute, 10),
    ).toHaveLength(0);

    await repository.ingestWebhook(
      input(
        webhook(
          "fingerprint-snapshot",
          "firing",
          "2026-08-08T18:08:00Z",
          "info",
        ),
        "2026-08-08T18:08:01Z",
      ),
    );
    const afterReopen = await repository.listAlerts({ limit: 10 });
    const reopened = afterReopen.items.find(
      (item) => item.fingerprint === "fingerprint-snapshot",
    );
    if (reopened === undefined) throw new Error("expected reopened occurrence");
    expect(reopened.lifecycleState).toBe("open");
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.resolutionSource).toBeNull();
    const reopenedDetail = await repository.getAlert({
      id: reopened.id,
      limit: 100,
    });
    expect(reopenedDetail?.events.at(-1)).toMatchObject({
      type: "opened",
      source: "webhook",
    });
    expect(
      await repository.pendingEmails(start + 9n * minute, 10),
    ).toHaveLength(0);

    await repository.ingestWebhook(
      input(
        webhook("fingerprint-webhook-authoritative", "resolved"),
        "2026-08-08T18:10:01Z",
      ),
    );
    const authoritativeSnapshot = AlertmanagerSnapshotAlertSchema.parse({
      ...alert,
      fingerprint: "fingerprint-webhook-authoritative",
      labels: { ...alert.labels, alertname: "WebhookAuthoritative" },
    });
    await repository.reconcileSnapshot({
      alerts: [alert, authoritativeSnapshot],
      startedAtNs: start + 10n * minute,
      completedAtNs: start + 10n * minute,
      missingGraceNs: 5n * minute,
    });
    const afterAuthoritativeSnapshot = await repository.listAlerts({
      limit: 10,
    });
    const authoritative = afterAuthoritativeSnapshot.items.find(
      (item) => item.fingerprint === "fingerprint-webhook-authoritative",
    );
    if (authoritative === undefined)
      throw new Error("expected webhook-resolved occurrence");
    expect(authoritative.lifecycleState).toBe("resolved");
    expect(authoritative.resolutionSource).toBe("webhook");
  });
});

describe("SQLite queries and outbox", () => {
  it("supports lifecycle pagination, indexed label queries, outbox transitions, and raw retention", async () => {
    await repository.ingestWebhook(
      input(webhook("fingerprint-a", "firing"), "2026-08-08T18:00:01Z"),
    );
    await repository.ingestWebhook(
      input(
        webhook("fingerprint-b", "firing", "2026-08-08T19:00:00Z"),
        "2026-08-08T19:00:01Z",
      ),
    );
    const first = await repository.listAlerts({
      limit: 1,
      label: { namespace: "storage" },
    });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null)
      throw new Error("expected a pagination cursor");
    const second = await repository.listAlerts({
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(1);
    const pending = await repository.pendingEmails(
      nanoseconds("2026-08-08T20:00:00Z"),
      10,
    );
    expect(pending).toHaveLength(2);
    const claimed = await repository.claimPendingEmails(
      nanoseconds("2026-08-08T20:00:00Z"),
      1,
      nanoseconds("2026-08-08T20:00:01Z"),
    );
    expect(claimed).toHaveLength(1);
    const claimedEmail = claimed[0];
    if (claimedEmail === undefined) throw new Error("expected pending email");
    const pendingStatus = await repository.systemStatus(
      true,
      nanoseconds("2026-08-08T20:00:00Z"),
    );
    expect(pendingStatus.oldestPendingEmailAt).toBe(
      InstantTextSchema.parse("2026-08-08T18:00:01Z"),
    );
    await repository.markEmailSent({
      id: claimedEmail.id,
      sendClaimId: claimedEmail.sendClaimId,
      sentAtNs: nanoseconds("2026-08-08T20:01:00Z"),
    });
    expect(
      await repository.pendingEmails(nanoseconds("2026-08-08T20:02:00Z"), 10),
    ).toHaveLength(1);
    const afterSendStatus = await repository.systemStatus(
      true,
      nanoseconds("2026-08-08T20:02:00Z"),
    );
    expect(afterSendStatus.oldestPendingEmailAt).toBe(
      InstantTextSchema.parse("2026-08-08T19:00:01Z"),
    );
    expect(
      await repository.purgeExpiredRawPayloads(
        nanoseconds("2026-08-08T21:00:00Z"),
      ),
    ).toBe(2);
    await expectNormalizedIndexes();
  });
  it("reports the latest successful reconciliation separately from later failures", async () => {
    const successAt = nanoseconds("2026-08-08T18:00:01Z");
    await repository.reconcileSnapshot({
      alerts: [],
      startedAtNs: nanoseconds("2026-08-08T18:00:00Z"),
      completedAtNs: successAt,
      missingGraceNs: 300_000_000_000n,
    });
    await repository.recordSnapshotFailure(
      nanoseconds("2026-08-08T18:01:00Z"),
      nanoseconds("2026-08-08T18:01:01Z"),
      "Alertmanager unavailable",
    );
    const status = await repository.systemStatus(
      false,
      nanoseconds("2026-08-08T18:01:02Z"),
    );
    expect(status.alertmanager).toBe("error");
    expect(status.lastReconciledAt).toBe(
      epochNanosecondsToInstantText(successAt),
    );
  });
});
describe("SQLite webhook authority", () => {
  it(
    "matches a refreshed-start resolution to its reconciled occurrence",
    matchesRefreshedResolution,
  );
  it(
    "keeps a stale resolution on the prior same-fingerprint occurrence",
    keepsStaleResolutionOnPriorOccurrence,
  );
});
