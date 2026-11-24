import { afterEach, expect, test } from "vitest";
import {
  ReportRunIngestBatchSchema,
  type ReportRunIngestItem,
} from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { reportHubIngestTotal } from "#observability/metrics-report.ts";
import type { ReportEnvelopeV1 } from "#shared/reports/report.ts";
import {
  reportReceiptKey,
  reportStateKey,
  type ReportDeliveryReceiptV1,
  type ReportStateV1,
} from "./report-delivery.ts";
import { reportSendClaimKey } from "./report-delivery-lease.ts";
import {
  runHubReportBackfillPage,
  runHubReportBackfillSafely,
  type HubBackfillCheckpointV1,
  type HubBackfillStorage,
} from "./report-hub-backfill.ts";
import {
  notificationSkipKey,
  type SkippedNotification,
} from "./report-notification-policy.ts";

const NOW = "2026-11-22T18:00:00.000Z";
const HUB_ENV = {
  OPS_DASHBOARD_URL: "https://hub.internal.test",
  OPS_INGEST_TOKEN: "secret-ingest-token",
};

function makeReport(input: {
  reportRunId: string;
  reportType: string;
  scheduleId: string;
  completedAt?: string;
}): ReportEnvelopeV1 {
  const completedAt = input.completedAt ?? NOW;
  return {
    schemaVersion: 1,
    reportRunId: input.reportRunId,
    reportType: input.reportType,
    title: `${input.reportType} report`,
    scheduleId: input.scheduleId,
    startedAt: "2026-11-22T17:59:00.000Z",
    completedAt,
    execution: "complete",
    verdict: "clear",
    headline: "All checks passed.",
    checks: [
      {
        id: "check-1",
        label: "Primary check",
        required: true,
        status: "passed",
        summary: "Passed",
        evidenceReceiptIds: ["ev-1"],
      },
    ],
    evidence: [
      {
        id: "ev-1",
        source: "fixture",
        observedAt: completedAt,
        status: "success",
      },
    ],
    findings: [],
    limitations: [],
    actions: [],
    provenance: {
      workflowId: `${input.scheduleId}-wf`,
      runId: "wf-run-1",
    },
  };
}

function createMemoryBackfillStorage() {
  const states = new Map<string, ReportStateV1>();
  const receipts = new Map<string, ReportDeliveryReceiptV1>();
  const observations = new Map<string, ReportEnvelopeV1>();
  const skips = new Map<string, SkippedNotification>();
  const extraKeys = new Set<string>();
  let checkpoint: { value: HubBackfillCheckpointV1; etag: string } | undefined;
  let version = 0;

  function allKeysUnder(prefix: string): string[] {
    const keys = new Set<string>();
    for (const key of [
      ...states.keys(),
      ...receipts.keys(),
      ...observations.keys(),
      ...skips.keys(),
      ...extraKeys,
    ]) {
      if (key.startsWith(prefix)) keys.add(key);
    }
    return [...keys].sort();
  }

  const storage: HubBackfillStorage = {
    receiptPrefix: "reports/receipts",
    statePrefix: "reports/state/",
    observationsPrefix: "reports/observations/prod/",
    listKeys: async ({ prefix, maxKeys, afterKey }) => {
      const matching = allKeysUnder(prefix).filter(
        (key) => afterKey === undefined || key > afterKey,
      );
      const keys = matching.slice(0, maxKeys);
      return { keys, truncated: matching.length > maxKeys };
    },
    readState: async (key) => {
      const value = states.get(key);
      if (value === undefined && extraKeys.has(key)) {
        throw new Error(`Unexpected readState on metadata key ${key}`);
      }
      return value;
    },
    readReceipt: async (key) => receipts.get(key),
    readObservation: async (key) => observations.get(key),
    readSkip: async (key) => skips.get(key),
    readCheckpoint: async () => checkpoint,
    writeCheckpoint: async (value, expectedEtag) => {
      if (checkpoint?.etag !== expectedEtag) return false;
      version += 1;
      checkpoint = { value, etag: `etag-${String(version)}` };
      return true;
    },
  };

  return {
    storage,
    states,
    receipts,
    observations,
    skips,
    extraKeys,
    getCheckpoint: () => checkpoint?.value,
  };
}

afterEach(() => {
  reportHubIngestTotal.reset();
});

test("reconstructs sent states, skipped observations, semantic mailboxes, and ignores send claims or unsettled runs", async () => {
  const mem = createMemoryBackfillStorage();

  const depsReport = makeReport({
    reportRunId: "dependency-summary:run-1",
    reportType: "dependency-summary",
    scheduleId: "deps-summary-weekly",
  });
  const depsStateKey = reportStateKey(depsReport);
  const depsReceipt: ReportDeliveryReceiptV1 = {
    schemaVersion: 1,
    reportRunId: depsReport.reportRunId,
    reportType: depsReport.reportType,
    scheduleId: depsReport.scheduleId,
    subject: "Dependencies: Up to date",
    messageId: "msg-deps-1",
    recipientId: 1,
    acceptedAt: NOW,
    reportStateKey: depsStateKey,
  };
  mem.states.set(depsStateKey, {
    schemaVersion: 1,
    report: depsReport,
    delivery: {
      status: "accepted",
      updatedAt: NOW,
      receipt: depsReceipt,
    },
  });
  mem.extraKeys.add(reportSendClaimKey(depsStateKey));
  mem.extraKeys.add("reports/state/deps-summary-weekly.json");
  mem.extraKeys.add("reports/state/scout-queue-windows.json");

  const pendingReport = makeReport({
    reportRunId: "link-rot-scan:run-pending",
    reportType: "link-rot-scan",
    scheduleId: "link-rot-scan-weekly",
  });
  mem.states.set(reportStateKey(pendingReport), {
    schemaVersion: 1,
    report: pendingReport,
    delivery: { status: "pending", updatedAt: NOW },
  });

  const skippedReport = makeReport({
    reportRunId: "homelab-audit:run-skip-1",
    reportType: "homelab-audit",
    scheduleId: "homelab-audit-daily",
  });
  const obsKey =
    "reports/observations/prod/homelab-audit/homelab-audit-daily/homelab-audit-run-skip-1.json";
  mem.observations.set(obsKey, skippedReport);
  mem.skips.set(notificationSkipKey(skippedReport, "prod"), {
    outcome: "skipped",
    reason: "unchanged",
    reportRunId: skippedReport.reportRunId,
    reportType: skippedReport.reportType,
    scheduleId: "homelab-audit-daily",
    completedAt: skippedReport.completedAt,
    observationKey: obsKey,
  });

  const stormReport = makeReport({
    reportRunId: "storm-promotion/daily/2026-11-22",
    reportType: "storm-promotion",
    scheduleId: "the-storm-promotion-daily",
  });
  const stormObsKey =
    "reports/observations/prod/storm-promotion/the-storm-promotion-daily/storm-promotion-daily-2026-11-22.json";
  mem.observations.set(stormObsKey, stormReport);
  mem.receipts.set(reportReceiptKey(stormReport), {
    schemaVersion: 1,
    reportRunId: stormReport.reportRunId,
    reportType: stormReport.reportType,
    scheduleId: stormReport.scheduleId,
    subject: "The Storm promotion: All clear",
    messageId: "msg-storm-1",
    recipientId: 2,
    acceptedAt: NOW,
    reportStateKey: reportStateKey(stormReport),
  });

  const ingested: ReportRunIngestItem[] = [];
  const result = await runHubReportBackfillPage({
    storage: mem.storage,
    now: () => NOW,
    ingestDeps: {
      env: HUB_ENV,
      fetchImpl: async (_url, init) => {
        const parsed = ReportRunIngestBatchSchema.parse(
          JSON.parse(typeof init.body === "string" ? init.body : "{}"),
        );
        ingested.push(...parsed.items);
        return Response.json({ ok: true });
      },
    },
  });

  expect(result).toEqual({ scanned: 7, pushed: 3, complete: true });
  expect(
    ingested.map((item) => ({
      id: item.report.reportRunId,
      status: item.deliveryStatus,
      skipReason: item.skipReason,
      from: item.mailboxFrom,
      to: item.mailboxTo,
    })),
  ).toEqual([
    {
      id: "dependency-summary:run-1",
      status: "sent",
      skipReason: undefined,
      from: "Repo Dependencies <deps@sjer.red>",
      to: "deps@sjer.red",
    },
    {
      id: "homelab-audit:run-skip-1",
      status: "skipped",
      skipReason: "unchanged",
      from: "Homelab Audit <ops@sjer.red>",
      to: "ops@sjer.red",
    },
    {
      id: "storm-promotion/daily/2026-11-22",
      status: "sent",
      skipReason: undefined,
      from: "Temporal Reports <reports@sjer.red>",
      to: "reports@sjer.red",
    },
  ]);
});

test("paginates bounded runs via checkpoint cursors and becomes a no-op once complete", async () => {
  const mem = createMemoryBackfillStorage();

  for (let i = 1; i <= 3; i++) {
    const r = makeReport({
      reportRunId: `scout-data-dragon:state-${String(i)}`,
      reportType: "scout-data-dragon",
      scheduleId: "scout-data-dragon-weekly-refresh",
    });
    const stateKey = reportStateKey(r);
    mem.states.set(stateKey, {
      schemaVersion: 1,
      report: r,
      delivery: {
        status: "accepted",
        updatedAt: NOW,
        receipt: {
          schemaVersion: 1,
          reportRunId: r.reportRunId,
          reportType: r.reportType,
          scheduleId: r.scheduleId,
          subject: "Scout update: Patch data up to date",
          messageId: `msg-${String(i)}`,
          recipientId: i,
          acceptedAt: NOW,
          reportStateKey: stateKey,
        },
      },
    });
  }

  for (let i = 1; i <= 2; i++) {
    const r = makeReport({
      reportRunId: `scout-queue-windows:obs-${String(i)}`,
      reportType: "scout-queue-windows",
      scheduleId: "scout-queue-windows-daily",
    });
    const obsKey = `reports/observations/prod/scout-queue-windows/scout-queue-windows-daily/obs-${String(i)}.json`;
    mem.observations.set(obsKey, r);
    mem.skips.set(notificationSkipKey(r, "prod"), {
      outcome: "skipped",
      reason: "unchanged",
      reportRunId: r.reportRunId,
      reportType: r.reportType,
      scheduleId: "scout-queue-windows-daily",
      completedAt: r.completedAt,
      observationKey: obsKey,
    });
  }

  const pushedIds: string[] = [];
  const ingestDeps = {
    env: HUB_ENV,
    fetchImpl: async (_url: string, init: RequestInit) => {
      const parsed = ReportRunIngestBatchSchema.parse(
        JSON.parse(typeof init.body === "string" ? init.body : "{}"),
      );
      for (const item of parsed.items) {
        pushedIds.push(item.report.reportRunId);
      }
      return Response.json({ ok: true });
    },
  };

  const page1 = await runHubReportBackfillPage({
    storage: mem.storage,
    ingestDeps,
    maxObjects: 2,
    now: () => NOW,
  });
  expect(page1).toEqual({ scanned: 2, pushed: 2, complete: false });
  expect(mem.getCheckpoint()?.state.complete).toBe(false);
  expect(mem.getCheckpoint()?.observations.complete).toBe(false);

  const page2 = await runHubReportBackfillPage({
    storage: mem.storage,
    ingestDeps,
    maxObjects: 2,
    now: () => NOW,
  });
  expect(page2).toEqual({ scanned: 2, pushed: 2, complete: false });
  expect(mem.getCheckpoint()?.state.complete).toBe(true);
  expect(mem.getCheckpoint()?.observations.complete).toBe(false);

  const page3 = await runHubReportBackfillPage({
    storage: mem.storage,
    ingestDeps,
    maxObjects: 2,
    now: () => NOW,
  });
  expect(page3).toEqual({ scanned: 1, pushed: 1, complete: true });
  expect(mem.getCheckpoint()).toMatchObject({
    state: { complete: true },
    observations: { complete: true },
  });

  const page4 = await runHubReportBackfillPage({
    storage: mem.storage,
    ingestDeps,
    maxObjects: 2,
    now: () => NOW,
  });
  expect(page4).toEqual({ scanned: 0, pushed: 0, complete: true });
  expect(pushedIds).toHaveLength(5);
});

test("isolates Hub errors without throwing or advancing the checkpoint cursor", async () => {
  const mem = createMemoryBackfillStorage();
  const r = makeReport({
    reportRunId: "homelab-audit:run-1",
    reportType: "homelab-audit",
    scheduleId: "homelab-audit-daily",
  });
  const stateKey = reportStateKey(r);
  mem.states.set(stateKey, {
    schemaVersion: 1,
    report: r,
    delivery: {
      status: "accepted",
      updatedAt: NOW,
      receipt: {
        schemaVersion: 1,
        reportRunId: r.reportRunId,
        reportType: r.reportType,
        scheduleId: r.scheduleId,
        subject: "Homelab check: All clear",
        messageId: "msg-1",
        recipientId: 1,
        acceptedAt: NOW,
        reportStateKey: stateKey,
      },
    },
  });

  let hubHealthy = false;
  const ingestDeps = {
    env: HUB_ENV,
    fetchImpl: async () =>
      hubHealthy
        ? Response.json({ ok: true })
        : new Response("Hub down", { status: 502 }),
  };

  const failedRun = await runHubReportBackfillSafely(undefined, {
    storage: mem.storage,
    ingestDeps,
    now: () => NOW,
  });
  expect(failedRun).toEqual({ scanned: 0, pushed: 0, complete: false });
  expect(mem.getCheckpoint()).toBeUndefined();

  const metric = await reportHubIngestTotal.get();
  expect(
    metric.values.find((entry) => entry.labels.outcome === "failed")?.value,
  ).toBe(1);

  hubHealthy = true;
  const recoveredRun = await runHubReportBackfillSafely(undefined, {
    storage: mem.storage,
    ingestDeps,
    now: () => NOW,
  });
  expect(recoveredRun).toEqual({ scanned: 1, pushed: 1, complete: true });
  expect(mem.getCheckpoint()?.state.complete).toBe(true);
});
