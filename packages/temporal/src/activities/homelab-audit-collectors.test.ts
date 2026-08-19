import { describe, expect, test } from "bun:test";
import { buildkiteBuildFinding } from "./homelab-audit-buildkite.ts";
import {
  interpretArgoApplications,
  prometheusCount,
  PrometheusResultSchema,
  temporalHealthQueries,
} from "./homelab-audit-collectors.ts";
import { interpretKubernetesWorkloads } from "./homelab-audit-kubernetes.ts";
import { buildHomelabAuditReport } from "./homelab-audit-report.ts";

describe("homelab audit collector interpretation", () => {
  test("does not mistake a healthy manual Argo application for broken automation", () => {
    const result = interpretArgoApplications([
      {
        metadata: { name: "manual-app" },
        spec: {},
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
        },
      },
    ]);

    expect(result.summary).toBe("0 unhealthy of 1 apps");
    expect(result.findings).toEqual([]);
  });

  test("interprets an explicit Argo automation disable semantically", () => {
    const result = interpretArgoApplications([
      {
        metadata: { name: "disabled-automation" },
        spec: { syncPolicy: { automated: { enabled: false, prune: true } } },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Degraded" },
        },
      },
    ]);

    expect(result.findings[0]?.detail).toContain("automation=disabled");
    expect(result.findings[0]?.detail).not.toContain("automation=enabled");
  });

  test("does not report healthy drift when automation is explicitly disabled", () => {
    const result = interpretArgoApplications([
      {
        metadata: { name: "disabled-manual-app" },
        spec: { syncPolicy: { automated: { enabled: false } } },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
        },
      },
    ]);

    expect(result.summary).toBe("0 unhealthy of 1 apps");
    expect(result.findings).toEqual([]);
  });

  test("treats a legacy automated block without enabled as enabled", () => {
    const result = interpretArgoApplications([
      {
        metadata: { name: "legacy-automation" },
        spec: {
          syncPolicy: { automated: { prune: true, selfHeal: true } },
        },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
        },
      },
    ]);

    expect(result.findings[0]?.detail).toContain(
      "automation=enabled (prune=true, selfHeal=true, allowEmpty=false)",
    );
  });

  test("reports failed Buildkite job log evidence instead of inferring from its label", () => {
    const finding = buildkiteBuildFinding(
      {
        number: 9001,
        state: "failed",
        web_url: "https://buildkite.com/sjerred/monorepo/builds/9001",
        commit: "abc123",
        jobs: [
          {
            id: "job-1",
            name: "Typecheck",
            state: "failed",
            web_url: null,
          },
        ],
      },
      [
        "build #9001 Typecheck: kubernetes scheduler rejected pod: Insufficient memory",
      ],
    );

    expect(finding.summary).toContain("#9001 failed");
    expect(finding.detail).toContain("Insufficient memory");
  });

  test("finds recently closed Temporal failures regardless of start time", () => {
    const queries = temporalHealthQueries(new Date("2026-08-10T18:00:00.000Z"));

    expect(queries.failed).toBe(
      'ExecutionStatus IN ("Failed", "TimedOut") AND CloseTime > "2026-08-09T18:00:00.000Z"',
    );
    expect(queries.failed).not.toContain("StartTime");
    expect(queries.stalled).toContain('StartTime < "2026-08-10T12:00:00.000Z"');
  });

  test("does not report completed job pods as unhealthy because containers exited", () => {
    const result = interpretKubernetesWorkloads({
      items: [
        {
          kind: "Pod",
          metadata: { name: "completed-job", namespace: "maintenance" },
          status: {
            phase: "Succeeded",
            containerStatuses: [{ name: "job", ready: false, restartCount: 0 }],
          },
        },
      ],
    });

    expect(result.summary).toBe("0 unhealthy of 1 workloads");
    expect(result.findings).toEqual([]);
  });

  test("reports a Deployment with missing replicas even when no pod is listed", () => {
    const result = interpretKubernetesWorkloads({
      items: [
        {
          kind: "Deployment",
          metadata: { name: "api", namespace: "service" },
          spec: { replicas: 2 },
          status: { availableReplicas: 0, updatedReplicas: 0 },
        },
      ],
    });

    expect(result.summary).toBe("1 unhealthy of 1 workloads");
    expect(result.findings[0]?.summary).toContain("Deployment");
    expect(result.findings[0]?.detail).toContain("desired=2; available=0");
  });

  test("refuses a clean verdict when any required collector failed", () => {
    const report = buildHomelabAuditReport(
      {
        startedAt: "2026-08-10T16:00:00.000Z",
        completedAt: "2026-08-10T16:01:00.000Z",
        checks: [
          {
            id: "collector",
            label: "Collector",
            required: true,
            status: "failed",
            summary: "API unavailable",
            evidenceReceiptIds: ["collector-evidence"],
          },
        ],
        evidence: [
          {
            id: "collector-evidence",
            source: "collector API",
            observedAt: "2026-08-10T16:00:30.000Z",
            status: "failure",
            excerpt: "HTTP 503",
          },
        ],
        findings: [],
        limitations: ["Collector did not complete: HTTP 503"],
      },
      undefined,
    );

    expect(report).toMatchObject({
      execution: "partial",
      verdict: "inconclusive",
    });
  });
});

describe("GCX Prometheus evidence", () => {
  test("parses and counts instant-vector results", () => {
    const result = PrometheusResultSchema.parse({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          { metric: { alertname: "One" }, value: [1, "1"] },
          { metric: { alertname: "Two" }, value: [1, "1"] },
        ],
      },
    });
    expect(prometheusCount(result)).toBe(2);
  });

  test("rejects a failed Prometheus response", () => {
    expect(() =>
      PrometheusResultSchema.parse({
        status: "error",
        data: { resultType: "vector", result: [] },
      }),
    ).toThrow();
  });
});
