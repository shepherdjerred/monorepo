import { afterEach, describe, expect, test } from "vitest";
import { ReportRunIngestBatchSchema } from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { reportHubIngestTotal } from "#observability/metrics-report.ts";
import type { ReportEnvelopeV1 } from "#shared/reports/report.ts";
import {
  buildHubReportIngestItem,
  pushReportRunsToHub,
  tryPushReportRunToHub,
} from "./report-hub-ingest.ts";

const NOW = "2026-11-22T18:00:00.000Z";

function sampleReport(id = "homelab-audit:run-1"): ReportEnvelopeV1 {
  return {
    schemaVersion: 1,
    reportRunId: id,
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    scheduleId: "homelab-audit-daily",
    startedAt: "2026-11-22T17:59:00.000Z",
    completedAt: NOW,
    execution: "complete",
    verdict: "clear",
    headline: "All homelab checks passed.",
    checks: [
      {
        id: "argocd-health",
        label: "Argo CD health",
        required: true,
        status: "passed",
        summary: "Healthy",
        evidenceReceiptIds: ["evidence-1"],
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        source: "argocd",
        observedAt: NOW,
        status: "success",
      },
    ],
    findings: [],
    limitations: [],
    actions: [],
    provenance: {
      workflowId: "homelab-audit-daily-1",
      runId: "wf-run-1",
    },
  };
}

async function counterValue(outcome: string): Promise<number> {
  const metric = await reportHubIngestTotal.get();
  return (
    metric.values.find((entry) => entry.labels.outcome === outcome)?.value ?? 0
  );
}

afterEach(() => {
  reportHubIngestTotal.reset();
});

describe("report Hub ingest", () => {
  test("builds validated sent and skipped ingest items with Hub HTML", () => {
    const sent = buildHubReportIngestItem({
      report: sampleReport(),
      addresses: {
        sender: "Homelab Audit <ops@sjer.red>",
        recipient: "ops@sjer.red",
      },
      delivery: {
        deliveryStatus: "sent",
        messageId: "msg-123",
        acceptedAt: NOW,
      },
    });
    expect(sent).toMatchObject({
      subject: "Homelab check: All clear",
      eyebrow: "Homelab Check",
      mailboxFrom: "Homelab Audit <ops@sjer.red>",
      mailboxTo: "ops@sjer.red",
      deliveryStatus: "sent",
      messageId: "msg-123",
      acceptedAt: NOW,
    });
    expect(sent.htmlBody).toContain("Open in Hub");

    const skipped = buildHubReportIngestItem({
      report: sampleReport("homelab-audit:run-2"),
      addresses: {
        sender: "Homelab Audit <ops@sjer.red>",
        recipient: "ops@sjer.red",
      },
      delivery: {
        deliveryStatus: "skipped",
        skipReason: "unchanged",
      },
    });
    expect(skipped).toMatchObject({
      deliveryStatus: "skipped",
      skipReason: "unchanged",
    });
    expect(skipped.messageId).toBeUndefined();
    expect(skipped.acceptedAt).toBeUndefined();
  });

  test("records outcome=unconfigured when Hub URL or token is absent", async () => {
    const item = buildHubReportIngestItem({
      report: sampleReport(),
      addresses: {
        sender: "Homelab Audit <ops@sjer.red>",
        recipient: "ops@sjer.red",
      },
      delivery: {
        deliveryStatus: "skipped",
        skipReason: "unchanged",
      },
    });

    const missingBoth = await pushReportRunsToHub([item], { env: {} });
    const missingToken = await pushReportRunsToHub([item], {
      env: {
        OPS_DASHBOARD_URL: "https://hub.example.test",
        OPS_INGEST_TOKEN: "  ",
      },
    });

    expect(missingBoth).toEqual({ pushed: 0 });
    expect(missingToken).toEqual({ pushed: 0 });
    expect(await counterValue("unconfigured")).toBe(2);
  });

  test("falls back to ALERT_DASHBOARD_URL, strips trailing slashes, and chunks batches <= 50", async () => {
    const items = Array.from({ length: 55 }, (_, index) =>
      buildHubReportIngestItem({
        report: sampleReport(`homelab-audit:run-${String(index + 1)}`),
        addresses: {
          sender: "Homelab Audit <ops@sjer.red>",
          recipient: "ops@sjer.red",
        },
        delivery: {
          deliveryStatus: "skipped",
          skipReason: "unchanged",
        },
      }),
    );

    const calls: { url: string; auth: string | null; count: number }[] = [];
    const result = await pushReportRunsToHub(items, {
      env: {
        ALERT_DASHBOARD_URL: "https://hub.internal.test///",
        OPS_INGEST_TOKEN: "secret-ingest-token",
      },
      fetchImpl: async (url, init) => {
        const headers = new Headers(init.headers);
        const batch = ReportRunIngestBatchSchema.parse(
          JSON.parse(typeof init.body === "string" ? init.body : "{}"),
        );
        calls.push({
          url,
          auth: headers.get("Authorization"),
          count: batch.items.length,
        });
        return Response.json({ ok: true });
      },
    });

    expect(result).toEqual({ pushed: 55 });
    expect(calls).toEqual([
      {
        url: "https://hub.internal.test/internal/v1/reports/runs",
        auth: "Bearer secret-ingest-token",
        count: 50,
      },
      {
        url: "https://hub.internal.test/internal/v1/reports/runs",
        auth: "Bearer secret-ingest-token",
        count: 5,
      },
    ]);
    expect(await counterValue("succeeded")).toBe(2);
  });

  test("tryPushReportRunToHub swallows HTTP and network failures and records outcome=failed", async () => {
    const httpError = await tryPushReportRunToHub(
      {
        report: sampleReport(),
        addresses: {
          sender: "Homelab Audit <ops@sjer.red>",
          recipient: "ops@sjer.red",
        },
        delivery: {
          deliveryStatus: "sent",
          messageId: "msg-1",
          acceptedAt: NOW,
        },
      },
      {
        env: {
          OPS_DASHBOARD_URL: "https://hub.internal.test",
          OPS_INGEST_TOKEN: "secret-ingest-token",
        },
        fetchImpl: async () => new Response("restarting", { status: 503 }),
      },
    );

    expect(httpError).toEqual({ pushed: 0 });
    expect(await counterValue("failed")).toBe(1);
  });
});
