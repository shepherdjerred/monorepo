import { z } from "zod/v4";
import { createTemporalReadClient } from "#client";
import {
  parseTemporalNamespace,
  temporalNamespacesForMonitoring,
  type TemporalNamespace,
} from "#shared/infra/temporal-namespace.ts";
import type {
  ReportCheckV1,
  ReportEvidenceReceiptV1,
  ReportEnvelopeV1,
} from "#shared/reports/report.ts";
import { ensureGcxContext } from "#activities/gcx-context.ts";
import { collectCiMain } from "./homelab-audit-ci.ts";
import {
  interpretKubernetesWorkloads,
  KubernetesWorkloadListSchema,
} from "./homelab-audit-kubernetes.ts";
import { sha256 } from "./homelab-audit-digest.ts";
import {
  temporalFailureRecovery,
  temporalStallReasons,
  type AuditTemporalExecution,
} from "./audit/temporal-state.ts";
import {
  inspectScheduleHealth,
  scheduleHealthReader,
} from "#activities/ops/temporal-schedules-client.ts";
import {
  AuditAlertOccurrenceSchema,
  deduplicateAuditFindings,
  interpretAlertOccurrences,
  interpretPrometheusAlerts,
} from "./audit/alerts.ts";

export const PrometheusResultSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.string(),
    result: z.array(z.unknown()),
  }),
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

async function runCommand(args: string[]): Promise<string> {
  const process = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env },
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
  prepare?: (() => Promise<void>) | undefined;
}): Promise<CollectorResult> {
  const observedAt = new Date().toISOString();
  const command = input.args.join(" ");
  try {
    await input.prepare?.();
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

export function prometheusCount(
  value: z.infer<typeof PrometheusResultSchema>,
): number {
  return value.data.result.length;
}

export function interpretArgoApplications(
  apps: z.infer<typeof ArgoApplicationsSchema>,
): { summary: string; findings: Finding[] } {
  const unhealthy = apps.filter((app) => {
    const automated = app.spec.syncPolicy?.automated;
    const isManual =
      automated === undefined ||
      automated === null ||
      automated.enabled === false;
    const isHealthyManualDrift =
      isManual &&
      app.status.sync.status === "OutOfSync" &&
      app.status.health.status === "Healthy";
    return (
      (app.status.sync.status !== "Synced" && !isHealthyManualDrift) ||
      !["Healthy", "Progressing"].includes(app.status.health.status) ||
      (app.status.operationState !== undefined &&
        ["Error", "Failed"].includes(app.status.operationState.phase))
    );
  });
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
          return automated.enabled === false
            ? "automation=disabled"
            : `automation=enabled (prune=${String(automated.prune ?? false)}, selfHeal=${String(automated.selfHeal ?? false)}, allowEmpty=${String(automated.allowEmpty ?? false)})`;
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
    failed: `ExecutionStatus IN ("Failed", "TimedOut") AND CloseTime > "${since}"`,
    stalled: `ExecutionStatus = "Running" AND StartTime < "${stalledSince}"`,
  };
}

type TemporalNamespaceHealth = {
  namespace: TemporalNamespace;
  failed: AuditTemporalExecution[];
  stalled: AuditTemporalExecution[];
  scheduleCount: number;
};

async function collectTemporalNamespace(
  namespace: TemporalNamespace,
  queries: ReturnType<typeof temporalHealthQueries>,
): Promise<TemporalNamespaceHealth> {
  const client = await createTemporalReadClient(namespace);
  const failed: AuditTemporalExecution[] = [];
  const stalled: AuditTemporalExecution[] = [];
  const collectExecutions = async (
    query: string,
    destination: AuditTemporalExecution[],
  ): Promise<void> => {
    for await (const workflow of client.workflow.list({ query })) {
      destination.push({
        namespace,
        workflowId: workflow.workflowId,
        runId: workflow.runId,
        ...(workflow.raw.firstRunId !== undefined &&
        workflow.raw.firstRunId !== null &&
        workflow.raw.firstRunId !== ""
          ? { firstRunId: workflow.raw.firstRunId }
          : {}),
        workflowType: workflow.type,
        startedAt: workflow.startTime.toISOString(),
      });
    }
  };
  const now = new Date();
  const [schedules] = await Promise.all([
    inspectScheduleHealth(scheduleHealthReader(client), namespace, now),
    collectExecutions(queries.failed, failed),
    collectExecutions(queries.stalled, stalled),
  ]);
  const executions = [...failed, ...stalled];
  for (let offset = 0; offset < executions.length; offset += 4) {
    await Promise.all(
      executions.slice(offset, offset + 4).map(async (workflow) => {
        const latest = await client.workflow
          .getHandle(workflow.workflowId)
          .describe();
        if (failed.includes(workflow)) {
          const recoveredBy = temporalFailureRecovery(
            workflow,
            latest,
            schedules,
            now,
          );
          if (recoveredBy !== undefined) workflow.recoveredBy = recoveredBy;
        } else {
          const exact =
            latest.runId === workflow.runId
              ? latest
              : await client.workflow
                  .getHandle(workflow.workflowId, workflow.runId)
                  .describe();
          workflow.stallReasons = temporalStallReasons(exact, now);
        }
      }),
    );
  }
  return { namespace, failed, stalled, scheduleCount: schedules.length };
}

export function temporalFindings(
  namespaceHealth: readonly TemporalNamespaceHealth[],
  evidenceId: string,
): Finding[] {
  return namespaceHealth.flatMap((health) => [
    ...health.failed.map((workflow) => ({
      id: `temporal:${workflow.namespace}:${workflow.workflowId}:failure`,
      state:
        workflow.recoveredBy === undefined
          ? ("active" as const)
          : ("recovered" as const),
      severity:
        workflow.recoveredBy === undefined
          ? ("warning" as const)
          : ("info" as const),
      summary: `Temporal ${workflow.namespace} ${workflow.recoveredBy === undefined ? "unrecovered failure" : "recovered failure"}: ${workflow.workflowId}`,
      detail: `namespace=${workflow.namespace}; type=${workflow.workflowType}; run=${workflow.runId}; started=${workflow.startedAt}${workflow.recoveredBy === undefined ? "" : `; recovered by ${workflow.recoveredBy}`}`,
      evidenceReceiptIds: [evidenceId],
    })),
    ...health.stalled.map((workflow) => ({
      id: `temporal:${workflow.namespace}:${workflow.workflowId}:progress`,
      state:
        (workflow.stallReasons?.length ?? 0) > 0
          ? ("active" as const)
          : ("observing" as const),
      severity:
        (workflow.stallReasons?.length ?? 0) > 0
          ? ("warning" as const)
          : ("info" as const),
      summary: `Temporal ${workflow.namespace} ${(workflow.stallReasons?.length ?? 0) > 0 ? "stalled task" : "long-running workflow; no stalled task observed"}: ${workflow.workflowId}`,
      detail: `namespace=${workflow.namespace}; type=${workflow.workflowType}; run=${workflow.runId}; started=${workflow.startedAt}; ${(workflow.stallReasons ?? []).join("; ") || "Age alone does not establish a stall; waiting workflows and recent heartbeats remain informational."}`,
      evidenceReceiptIds: [evidenceId],
    })),
  ]);
}

async function collectTemporal(): Promise<CollectorResult> {
  const queries = temporalHealthQueries(new Date());
  const failedQuery = queries.failed;
  const stalledQuery = queries.stalled;
  const observedAt = new Date().toISOString();
  const evidenceId = "temporal-health-evidence";
  try {
    const namespaces = temporalNamespacesForMonitoring(
      parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]),
    );
    const namespaceHealth = await Promise.all(
      namespaces.map(
        async (namespace) => await collectTemporalNamespace(namespace, queries),
      ),
    );
    const failed = namespaceHealth.flatMap((health) => health.failed);
    const stalled = namespaceHealth.flatMap((health) => health.stalled);
    const scheduleCount = namespaceHealth.reduce(
      (count, health) => count + health.scheduleCount,
      0,
    );
    const findings = temporalFindings(namespaceHealth, evidenceId);
    const combined = JSON.stringify({
      namespaces: namespaceHealth,
      queries: { failed: failedQuery, stalled: stalledQuery },
    });
    return {
      check: {
        id: "temporal-health",
        label: "Temporal failures and stalls",
        required: true,
        status: "passed",
        summary: `${failed.filter((workflow) => workflow.recoveredBy === undefined).length.toString()} unrecovered and ${failed.filter((workflow) => workflow.recoveredBy !== undefined).length.toString()} recovered failures in 24h; ${stalled.filter((workflow) => (workflow.stallReasons?.length ?? 0) > 0).length.toString()} stalled tasks among ${stalled.length.toString()} workflows over 6h; ${scheduleCount.toString()} schedules across ${namespaces.join(", ")}`,
        evidenceReceiptIds: [evidenceId],
      },
      evidence: {
        id: evidenceId,
        source: "Temporal visibility and schedule APIs",
        observedAt,
        status: "success",
        command: `Temporal SDK namespace queries (${namespaces.join(", ")}): ${failedQuery}; ${stalledQuery}; schedule list`,
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
        "prom",
        "query",
        'ALERTS{alertstate="firing"}',
        "-o",
        "json",
      ],
      schema: PrometheusResultSchema,
      prepare: ensureGcxContext,
      interpret: (value) => interpretPrometheusAlerts(value.data.result),
    }),
    commandCollector({
      id: "alerts-occurrences",
      label: "Open durable alert occurrences",
      args: ["toolkit", "alerts", "list", "--state", "open", "--json"],
      schema: z.array(AuditAlertOccurrenceSchema),
      interpret: interpretAlertOccurrences,
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
      args: ["toolkit", "argocd", "app", "list", "-o", "json"],
      schema: ArgoApplicationsSchema,
      interpret: interpretArgoApplications,
    }),
    collectCiMain(),
  ]);
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    checks: results.map((result) => result.check),
    evidence: results.map((result) => result.evidence),
    findings: deduplicateAuditFindings(
      results.flatMap((result) => result.findings),
    ),
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
