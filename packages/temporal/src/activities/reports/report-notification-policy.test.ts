import { expect, test } from "vitest";
import {
  ReportEnvelopeV1Schema,
  type ReportEnvelopeV1,
} from "#shared/reports/report.ts";
import {
  deliverReportWithDependencies,
  reportReceiptKey,
  type ReportDeliveryBackend,
  type ReportDeliveryReceiptV1,
  type ReportStateV1,
} from "./report-delivery.ts";
import type { ReportSendClaimV1 } from "./report-delivery-lease.ts";
import type { PostalSendInput } from "#shared/infra/postal.ts";
import {
  deliverDailyNotification,
  notificationCondition,
  usesDailyNotificationPolicy,
  selectNotificationMode,
  type NotificationMode,
  type NotificationBackend,
  type NotificationFamily,
  type SkippedNotification,
} from "./report-notification-policy.ts";

function report(
  day: number,
  condition: string | null = "disk-pressure",
): ReportEnvelopeV1 {
  const completedAt = new Date(Date.UTC(2026, 9, day)).toISOString();
  return ReportEnvelopeV1Schema.parse({
    schemaVersion: 1,
    reportRunId: `daily:run-${String(day)}`,
    reportType: "homelab-audit",
    scheduleId: "homelab-audit-daily",
    title: "Homelab audit",
    startedAt: completedAt,
    completedAt,
    execution: "complete",
    verdict: condition === null ? "clear" : "attention",
    headline: "Collected current infrastructure state.",
    checks: [
      {
        id: "collector",
        label: "Collector",
        required: true,
        status: "passed",
        summary: "Collected",
        evidenceReceiptIds: ["evidence"],
      },
    ],
    evidence: [
      {
        id: "evidence",
        source: "test",
        observedAt: completedAt,
        status: "success",
      },
    ],
    findings:
      condition === null
        ? []
        : [
            {
              id: condition,
              severity: "warning",
              state: "active",
              summary: "Disk pressure",
              detail: `Observed on day ${String(day)}`,
              evidenceReceiptIds: ["evidence"],
            },
          ],
    limitations: [],
    actions: [],
    provenance: { workflowId: "audit", runId: `run-${String(day)}` },
  });
}

function harness() {
  const observations = new Map<string, ReportEnvelopeV1>();
  const skips = new Map<string, SkippedNotification>();
  const families = new Map<
    string,
    { value: NotificationFamily; etag: string }
  >();
  const receipts = new Map<string, ReportDeliveryReceiptV1>();
  const states = new Map<string, ReportStateV1>();
  const claims = new Map<string, { claim: ReportSendClaimV1; etag: string }>();
  const sent: string[] = [];
  let version = 0;
  const faults = { failFamilySettlement: false, failSend: false };
  const backend: NotificationBackend = {
    readObservation: async (key) => observations.get(key),
    writeObservation: async (key, value) => {
      if (observations.has(key)) return false;
      observations.set(key, structuredClone(value));
      return true;
    },
    readSkip: async (key) => skips.get(key),
    writeSkip: async (key, value) => {
      if (skips.has(key)) return false;
      skips.set(key, value);
      return true;
    },
    readFamily: async (key) => structuredClone(families.get(key)),
    writeFamily: async (key, value, expectedEtag) => {
      if (faults.failFamilySettlement && value.pending === undefined) {
        faults.failFamilySettlement = false;
        throw new Error("crash after accepted receipt");
      }
      if (families.get(key)?.etag !== expectedEtag) return false;
      families.set(key, { value, etag: String(++version) });
      return true;
    },
  };
  const deliveryBackend: ReportDeliveryBackend = {
    readReceipt: async (key) => receipts.get(key),
    writeReceipt: async (key, value) => {
      if (receipts.has(key)) return false;
      receipts.set(key, value);
      return true;
    },
    readState: async (key) => states.get(key),
    writeState: async (key, value) => {
      states.set(key, value);
    },
    readSendClaim: async (key) => claims.get(key),
    writeSendClaim: async (key, claim, expectedEtag) => {
      if (claims.get(key)?.etag !== expectedEtag) return false;
      claims.set(key, { claim, etag: String(++version) });
      return true;
    },
  };
  function deps(now: string, owner = now, namespace = "prod") {
    const deliveryDeps = {
      backend: deliveryBackend,
      now: () => now,
      owner,
      attemptStartedAt: now,
      addresses: {
        recipient: "recipient@example.com",
        sender: "sender@example.com",
      },
      send: async (input: PostalSendInput) => {
        if (faults.failSend) throw new Error("Postal unavailable");
        const reportRunId = input.headers?.["X-Report-Run-ID"];
        if (reportRunId === undefined)
          throw new Error("Missing report run header");
        sent.push(reportRunId);
        return {
          messageId: `mail-${String(sent.length)}`,
          recipientId: 42,
          subject: input.subject,
          tag: input.tag,
        };
      },
    };
    return {
      backend,
      namespace,
      owner,
      attemptStartedAt: now,
      now: () => now,
      accepted: async (candidate: ReportEnvelopeV1) => {
        const receiptKey = reportReceiptKey(candidate);
        const value = receipts.get(receiptKey);
        return value === undefined
          ? undefined
          : { ...value, receiptKey, deduplicated: true };
      },
      deliver: (candidate: ReportEnvelopeV1) =>
        deliverReportWithDependencies(candidate, deliveryDeps),
    };
  }
  return { deps, sent, observations, skips, families, faults };
}

test.each([false, true])(
  "freezes the first %s admission choice across flag changes",
  async (initial) => {
    let stored: NotificationMode | undefined;
    let enabled = initial;
    const deps = {
      read: async () => stored,
      write: async (value: NotificationMode) => {
        if (stored !== undefined) return false;
        stored = value;
        return true;
      },
      legacyDeliveryStarted: async () => false,
      enabled: async () => enabled,
    };
    const first = await selectNotificationMode(deps);
    enabled = !initial;
    expect(await selectNotificationMode(deps)).toBe(first);
  },
);

test("finishes a delivery already started by the prior worker with cadence semantics", async () => {
  let stored: NotificationMode | undefined;
  expect(
    await selectNotificationMode({
      read: async () => stored,
      write: async (value) => {
        stored = value;
        return true;
      },
      legacyDeliveryStarted: async () => true,
      enabled: async () => {
        throw new Error("Legacy delivery must keep its mode");
      },
    }),
  ).toBe("cadence");
});

test("archives every report, skips unchanged findings, and reminds after seven days", async () => {
  const h = harness();
  for (let day = 1; day <= 8; day++) {
    const r = report(day);
    const result = await deliverDailyNotification(r, h.deps(r.completedAt));
    if (day === 1 || day === 8)
      expect(result).toMatchObject({ deduplicated: false });
    if (day > 1 && day < 8) {
      expect(result).toMatchObject({ outcome: "skipped", reason: "unchanged" });
      expect(result).not.toHaveProperty("acceptedAt");
      expect(result).not.toHaveProperty("messageId");
    }
  }
  expect(h.sent).toEqual(["daily:run-1", "daily:run-8"]);
  expect(h.observations.size).toBe(8);
  expect(h.skips.size).toBe(6);
});

test("sends a changed finding and recovery once, then keeps clear reports silent", async () => {
  const h = harness();
  const observations = [
    report(1),
    report(2, "backup-failure"),
    report(3, null),
    report(4, null),
    report(12, null),
  ];
  for (const r of observations)
    await deliverDailyNotification(r, h.deps(r.completedAt));
  expect(h.sent).toEqual(["daily:run-1", "daily:run-2", "daily:run-3"]);
});

test("suppressed and recovered findings preserve the clear condition", () => {
  const r = report(1);
  r.verdict = "clear";
  const clear = { ...r, findings: [] };
  for (const state of ["suppressed", "recovered", "observing"] as const) {
    const inactive = {
      ...r,
      findings: r.findings.map((finding) => ({ ...finding, state })),
    };
    expect(notificationCondition(inactive)).toEqual(
      notificationCondition(clear),
    );
  }
});

test("unknown findings keep their detail and partial failures keep error text", () => {
  const first = report(1);
  first.findings = first.findings.map((finding) => ({
    ...finding,
    id: undefined,
  }));
  const changed = {
    ...first,
    findings: first.findings.map((finding) => ({
      ...finding,
      detail: "A different failure",
    })),
  };
  expect(notificationCondition(changed).fingerprint).not.toBe(
    notificationCondition(first).fingerprint,
  );
  const partial = { ...first, execution: "partial" as const };
  expect(
    notificationCondition({
      ...partial,
      checks: partial.checks.map((check) => ({
        ...check,
        summary: "Different collector error",
      })),
    }).fingerprint,
  ).not.toBe(notificationCondition(partial).fingerprint);
});

test("two concurrent changed runs cannot both own the family send", async () => {
  const h = harness();
  const r = report(1);
  const other = { ...r, reportRunId: "other-run" };
  const results = await Promise.allSettled([
    deliverDailyNotification(r, h.deps(r.completedAt, "owner-a")),
    deliverDailyNotification(other, h.deps(r.completedAt, "owner-b")),
  ]);
  expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  expect(h.sent).toHaveLength(1);
});

test("settles a crash after acceptance before deciding the next report", async () => {
  const h = harness();
  const first = report(1);
  h.faults.failFamilySettlement = true;
  await expect(
    deliverDailyNotification(first, h.deps(first.completedAt)),
  ).rejects.toThrow("crash after accepted receipt");
  const next = report(2);
  await expect(
    deliverDailyNotification(next, h.deps(next.completedAt)),
  ).resolves.toMatchObject({ outcome: "skipped" });
  expect(h.sent).toEqual([first.reportRunId]);
  expect([...h.families.values()][0]?.value.lastAccepted?.reportRunId).toBe(
    first.reportRunId,
  );
});

test("a failed send neither suppresses a changed report nor advances last acceptance", async () => {
  const h = harness();
  const first = report(1);
  h.faults.failSend = true;
  await expect(
    deliverDailyNotification(first, h.deps(first.completedAt)),
  ).rejects.toThrow("Postal unavailable");
  expect([...h.families.values()][0]?.value.lastAccepted).toBeUndefined();
  h.faults.failSend = false;
  const next = report(2, "backup-failure");
  await deliverDailyNotification(next, h.deps(next.completedAt));
  expect(h.sent).toEqual([first.reportRunId, next.reportRunId]);
});

test("an old retry is superseded and preserves its original archived time", async () => {
  const h = harness();
  const first = report(1);
  await deliverDailyNotification(first, h.deps(first.completedAt));
  const recent = report(3, "backup-failure");
  await deliverDailyNotification(recent, h.deps(recent.completedAt));
  const older = report(2);
  await expect(
    deliverDailyNotification(older, h.deps(recent.completedAt)),
  ).resolves.toMatchObject({ reason: "superseded" });
  const retry = { ...older, completedAt: report(4).completedAt };
  await expect(
    deliverDailyNotification(retry, h.deps(retry.completedAt)),
  ).resolves.toMatchObject({ completedAt: older.completedAt });
  expect(h.sent).toEqual([first.reportRunId, recent.reportRunId]);
});

test("separates beta state and excludes digests, canaries, manual and checkpointed reports", async () => {
  const h = harness();
  const prod = report(1);
  const beta = { ...prod, reportRunId: "beta:run-1" };
  await deliverDailyNotification(prod, h.deps(prod.completedAt));
  await deliverDailyNotification(
    beta,
    h.deps(beta.completedAt, "beta", "beta"),
  );
  expect(h.sent).toHaveLength(2);
  expect(h.families.size).toBe(2);
  for (const reportType of [
    "dependency-summary",
    "tasknotes-canary",
    "ops-digest",
  ]) {
    expect(usesDailyNotificationPolicy({ ...prod, reportType })).toBe(false);
  }
  expect(usesDailyNotificationPolicy({ reportType: prod.reportType })).toBe(
    false,
  );
});
