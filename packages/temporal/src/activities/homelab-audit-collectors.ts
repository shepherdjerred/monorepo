import { z } from "zod/v4";
import { createTemporalClient } from "#client";
import type {
  ReportCheckV1,
  ReportEvidenceReceiptV1,
  ReportEnvelopeV1,
} from "#shared/report.ts";
import { collectBuildkite } from "./homelab-audit-buildkite.ts";
import {
  interpretKubernetesWorkloads,
  KubernetesWorkloadListSchema,
} from "./homelab-audit-kubernetes.ts";

const PrometheusResultSchema = z.object({
  results: z.record(
    z.string(),
    z.object({
      frames: z.array(
        z.object({
          schema: z.object({
            fields: z.array(
              z.object({
                name: z.string(),
                labels: z.record(z.string(), z.string()).optional(),
              }),
            ),
          }),
          data: z.object({ values: z.array(z.array(z.unknown())) }),
        }),
      ),
    }),
  ),
});
const AlertOccurrenceSchema = z.object({
  id: z.string(),
  alertname: z.string(),
  namespace: z.string().nullable(),
  severity: z.string(),
  summary: z.string(),
  lifecycleState: z.literal("open"),
  suppressionState: z.string(),
});
const ArgoApplicationsSchema = z.array(
  z.object({
    metadata: z.object({ name: z.string() }),
    spec: z.object({
      syncPolicy: z
        .object({
          automated: z
            .object({
              enabled: z.boolean().nullable().optional(),
              prune: z.boolean().optional(),
              selfHeal: z.boolean().optional(),
              allowEmpty: z.boolean().optional(),
            })
            .nullable()
            .optional(),
        })
        .optional(),
    }),
    status: z.object({
      sync: z.object({ status: z.string() }),
      health: z.object({ status: z.string() }),
      operationState: z
        .object({ phase: z.string(), message: z.string().optional() })
        .optional(),
    }),
  }),
);
type Finding = ReportEnvelopeV1["findings"][number];

export type HomelabAuditCollection = {
  startedAt: string;
  completedAt: string;
  checks: ReportCheckV1[];
  evidence: ReportEvidenceReceiptV1[];
  findings: Finding[];
  limitations: string[];
};

type CollectorResult = {
  check: ReportCheckV1;
  evidence: ReportEvidenceReceiptV1;
  findings: Finding[];
  limitation: string | undefined;
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function runCommand(args: string[]): Promise<string> {
  const process = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      BUILDKITE_ORGANIZATION_SLUG:
        Bun.env["BUILDKITE_ORGANIZATION_SLUG"] ?? "sjerred",
      BUILDKITE_PIPELINE_SLUG: Bun.env["BUILDKITE_PIPELINE_SLUG"] ?? "monorepo",
    },
  });
  const timeout = setTimeout(() => {
    process.kill();
  }, 30_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `${args.join(" ")} exited ${exitCode.toString()}: ${stderr.trim().slice(0, 1000)}`,
      );
    }
    return stdout;
  } finally {
    clearTimeout(timeout);
  }
}

async function commandCollector<T>(input: {
  id: string;
  label: string;
  args: string[];
  schema: z.ZodType<T>;
  interpret: (value: T) => { summary: string; findings: Finding[] };
}): Promise<CollectorResult> {
  const observedAt = new Date().toISOString();
  const command = input.args.join(" ");
  try {
    const stdout = await runCommand(input.args);
    const value = input.schema.parse(JSON.parse(stdout));
    const interpreted = input.interpret(value);
    const evidenceId = `${input.id}-evidence`;
    return {
      check: {
        id: input.id,
        label: input.label,
        required: true,
        status: "passed",
        summary: interpreted.summary,
        evidenceReceiptIds: [evidenceId],
      },
      evidence: {
        id: evidenceId,
        source: input.label,
        observedAt,
        status: "success",
        command,
        excerpt: stdout.trim().slice(0, 2000) || "Empty JSON result",
        contentSha256: await sha256(stdout),
      },
      findings: interpreted.findings.map((finding) => ({
        ...finding,
        evidenceReceiptIds: [evidenceId],
      })),
      limitation: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const evidenceId = `${input.id}-evidence`;
    return {
      check: {
        id: input.id,
        label: input.label,
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: [evidenceId],
      },
      evidence: {
        id: evidenceId,
        source: input.label,
        observedAt,
        status: "failure",
        command,
        excerpt: message.slice(0, 2000),
        contentSha256: await sha256(message),
      },
      findings: [],
      limitation: `${input.label} did not complete: ${message}`,
    };
  }
}

function prometheusCount(
  value: z.infer<typeof PrometheusResultSchema>,
): number {
  return Object.values(value.results).reduce(
    (total, result) =>
      total +
      result.frames.reduce(
        (frameTotal, frame) =>
          frameTotal +
          Math.max(0, ...frame.data.values.map((values) => values.length)),
        0,
      ),
    0,
  );
}

export function interpretArgoApplications(
  apps: z.infer<typeof ArgoApplicationsSchema>,
): { summary: string; findings: Finding[] } {
  const unhealthy = apps.filter(
    (app) =>
      app.status.sync.status !== "Synced" ||
      !["Healthy", "Progressing"].includes(app.status.health.status) ||
      (app.status.operationState !== undefined &&
        ["Error", "Failed"].includes(app.status.operationState.phase)),
  );
  return {
    summary: `${unhealthy.length.toString()} unhealthy of ${apps.length.toString()} apps`,
    findings: unhealthy.map((app) => ({
      severity: "warning",
      summary: `${app.metadata.name}: sync=${app.status.sync.status}, health=${app.status.health.status}`,
      detail: [
        (() => {
          const automated = app.spec.syncPolicy?.automated;
          if (automated === undefined || automated === null) {
            return "automation=manual";
          }
          if (automated.enabled === false) {
            return "automation=disabled";
          }
          return `automation=enabled (prune=${String(automated.prune ?? false)}, selfHeal=${String(automated.selfHeal ?? false)}, allowEmpty=${String(automated.allowEmpty ?? false)})`;
        })(),
        app.status.operationState === undefined
          ? undefined
          : `operation=${app.status.operationState.phase}: ${app.status.operationState.message ?? ""}`,
      ]
        .filter((value) => value !== undefined)
        .join("; "),
      evidenceReceiptIds: [],
    })),
  };
}

export function temporalHealthQueries(now: Date): {
  failed: string;
  stalled: string;
} {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const stalledSince = new Date(
    now.getTime() - 6 * 60 * 60 * 1000,
  ).toISOString();
  return {
    failed: `ExecutionStatus = "Failed" AND CloseTime > "${since}"`,
    stalled: `ExecutionStatus = "Running" AND StartTime < "${stalledSince}"`,
  };
}

async function collectTemporal(): Promise<CollectorResult> {
  const queries = temporalHealthQueries(new Date());
  const failedQuery = queries.failed;
  const stalledQuery = queries.stalled;
  const observedAt = new Date().toISOString();
  const evidenceId = "temporal-health-evidence";
  try {
    const client = await createTemporalClient();
    const failed: { workflowId: string; runId: string; startedAt: string }[] =
      [];
    const stalled: { workflowId: string; runId: string; startedAt: string }[] =
      [];
    let scheduleCount = 0;
    const collectExecutions = async (
      query: string,
      destination: { workflowId: string; runId: string; startedAt: string }[],
    ): Promise<void> => {
      for await (const workflow of client.workflow.list({ query })) {
        destination.push({
          workflowId: workflow.workflowId,
          runId: workflow.runId,
          startedAt: workflow.startTime.toISOString(),
        });
      }
    };
    await Promise.all([
      collectExecutions(failedQuery, failed),
      collectExecutions(stalledQuery, stalled),
      (async () => {
        for await (const _schedule of client.schedule.list())
          scheduleCount += 1;
      })(),
    ]);
    const findings: Finding[] = [
      ...failed.map((workflow) => ({
        severity: "warning" as const,
        summary: `Temporal failure: ${workflow.workflowId}`,
        detail: `run=${workflow.runId}; started=${workflow.startedAt}`,
        evidenceReceiptIds: [evidenceId],
      })),
      ...stalled.map((workflow) => ({
        severity: "warning" as const,
        summary: `Temporal workflow running over six hours: ${workflow.workflowId}`,
        detail: `run=${workflow.runId}; started=${workflow.startedAt}`,
        evidenceReceiptIds: [evidenceId],
      })),
    ];
    const combined = JSON.stringify({
      failed,
      stalled,
      scheduleCount,
      queries: { failed: failedQuery, stalled: stalledQuery },
    });
    return {
      check: {
        id: "temporal-health",
        label: "Temporal failures and stalls",
        required: true,
        status: "passed",
        summary: `${failed.length.toString()} failures in 24h; ${stalled.length.toString()} workflows over 6h; ${scheduleCount.toString()} schedules`,
        evidenceReceiptIds: [evidenceId],
      },
      evidence: {
        id: evidenceId,
        source: "Temporal visibility and schedule APIs",
        observedAt,
        status: "success",
        command: `Temporal SDK visibility queries: ${failedQuery}; ${stalledQuery}; schedule list`,
        excerpt: combined.slice(0, 2000),
        contentSha256: await sha256(combined),
      },
      findings,
      limitation: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      check: {
        id: "temporal-health",
        label: "Temporal failures and stalls",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: [evidenceId],
      },
      evidence: {
        id: evidenceId,
        source: "Temporal visibility and schedule APIs",
        observedAt,
        status: "failure",
        command: `Temporal SDK visibility queries: ${failedQuery}; ${stalledQuery}; schedule list`,
        excerpt: message.slice(0, 2000),
        contentSha256: await sha256(message),
      },
      findings: [],
      limitation: `Temporal health did not complete: ${message}`,
    };
  }
}

export async function collectHomelabAuditEvidence(): Promise<HomelabAuditCollection> {
  const startedAt = new Date().toISOString();
  const results = await Promise.all([
    commandCollector({
      id: "prometheus-alerts",
      label: "Firing Prometheus alerts",
      args: [
        "toolkit",
        "gf",
        "query",
        'ALERTS{alertstate="firing"}',
        "--instant",
        "--json",
      ],
      schema: PrometheusResultSchema,
      interpret: (value) => {
        const count = prometheusCount(value);
        return {
          summary: `${count.toString()} firing series`,
          findings:
            count === 0
              ? []
              : [
                  {
                    severity: "warning",
                    summary: `${count.toString()} Prometheus alert series are firing`,
                    evidenceReceiptIds: [],
                  },
                ],
        };
      },
    }),
    commandCollector({
      id: "alerts-occurrences",
      label: "Open durable alert occurrences",
      args: ["toolkit", "alerts", "list", "--state", "open", "--json"],
      schema: z.array(AlertOccurrenceSchema),
      interpret: (alerts) => ({
        summary: `${alerts.length.toString()} open occurrences`,
        findings: alerts.map((alert) => ({
          severity: alert.severity === "critical" ? "critical" : "warning",
          summary: `${alert.alertname}: ${alert.summary}`,
          detail: `id=${alert.id}; namespace=${alert.namespace ?? "none"}; suppression=${alert.suppressionState}`,
          evidenceReceiptIds: [],
        })),
      }),
    }),
    collectTemporal(),
    commandCollector({
      id: "kubernetes-health",
      label: "Kubernetes workload health",
      args: [
        "kubectl",
        "get",
        "pods,deployments,statefulsets,daemonsets",
        "-A",
        "-o",
        "json",
      ],
      schema: KubernetesWorkloadListSchema,
      interpret: interpretKubernetesWorkloads,
    }),
    commandCollector({
      id: "argocd-health",
      label: "ArgoCD application health",
      args: ["argocd", "app", "list", "--grpc-web", "-o", "json"],
      schema: ArgoApplicationsSchema,
      interpret: interpretArgoApplications,
    }),
    collectBuildkite(),
  ]);
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    checks: results.map((result) => result.check),
    evidence: results.map((result) => result.evidence),
    findings: results.flatMap((result) => result.findings),
    limitations: results.flatMap((result) =>
      result.limitation === undefined ? [] : [result.limitation],
    ),
  };
}

export const homelabAuditCollectorActivities = {
  collectHomelabAuditEvidence,
};

export type HomelabAuditCollectorActivities =
  typeof homelabAuditCollectorActivities;
