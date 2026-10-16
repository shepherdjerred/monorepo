// Frozen pre-Tracker commands and payloads. Never derive these from the live inventory.
import {
  ActivityFailure,
  isCancellation,
  patched,
  proxyActivities,
} from "@temporalio/workflow";
import type { OpsActivities } from "#activities/ops/ops-activities.ts";
import type { OpsCollectorOutcome } from "#activities/ops/ops-publish.ts";

export async function runOpsSnapshot() {
  const taskQueue = patched("ops-isolated-activity-queue") ? "ops" : "infra";
  const readers = proxyActivities<OpsActivities>({
    taskQueue,
    startToCloseTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "5 seconds",
      maximumInterval: "5 seconds",
    },
  });
  const publication = proxyActivities<OpsActivities>({
    taskQueue,
    startToCloseTimeout: "30 seconds",
    retry: {
      maximumAttempts: 3,
      initialInterval: "5 seconds",
      backoffCoefficient: 2,
      maximumInterval: "20 seconds",
    },
  });
  const withTraces = patched("ops-traces-collector");
  const withTemporal = patched("ops-temporal-schedules-collector");
  const historical = [
    { source: "alerts", invoke: readers.collectOpsAlerts },
    { source: "kubernetes", invoke: readers.collectOpsKubernetes },
    { source: "argocd", invoke: readers.collectOpsArgocd },
    { source: "talos", invoke: readers.collectOpsTalos },
    { source: "ci", invoke: readers.collectOpsCi },
    { source: "github", invoke: readers.collectOpsGithub },
    { source: "renovate", invoke: readers.collectOpsRenovate },
    { source: "linear", invoke: readers.collectOpsLinear },
    { source: "bugsink", invoke: readers.collectOpsBugsink },
    { source: "posthog", invoke: readers.collectOpsPosthog },
    { source: "probes", invoke: readers.collectOpsProbes },
    { source: "logs", invoke: readers.collectOpsLogs },
    { source: "traces", invoke: readers.collectOpsTraces },
    { source: "maintenance", invoke: readers.collectOpsMaintenance },
    { source: "temporal", invoke: readers.collectOpsTemporal },
    { source: "ai", invoke: readers.collectOpsAi },
  ] as const;
  const collected = await Promise.all(
    historical.map(async (entry): Promise<OpsCollectorOutcome> => {
      if (
        (!withTraces && entry.source === "traces") ||
        (!withTemporal && entry.source === "temporal")
      )
        return {
          source: entry.source,
          ok: false,
          error: "not collected by this workflow build",
        };
      try {
        return { source: entry.source, ok: true, result: await entry.invoke() };
      } catch (error_: unknown) {
        if (isCancellation(error_)) throw error_;
        const error =
          error_ instanceof ActivityFailure && error_.cause
            ? error_.cause.message
            : error_ instanceof Error
              ? error_.message
              : String(error_);
        return { source: entry.source, ok: false, error };
      }
    }),
  );
  return await publication.assembleAndPublishOpsSnapshot({
    outcomes: collected,
  });
}
