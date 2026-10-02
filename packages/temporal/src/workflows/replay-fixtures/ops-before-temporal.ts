import { patched, proxyActivities } from "@temporalio/workflow";
import type { OpsActivities } from "#activities/ops/ops-activities.ts";
import type {
  OpsCollectorOutcome,
  OpsPublishSummary,
} from "#activities/ops/ops-publish.ts";

const collectors = proxyActivities<OpsActivities>({
  taskQueue: "infra",
  startToCloseTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 seconds",
    maximumInterval: "5 seconds",
  },
});
const { assembleAndPublishOpsSnapshot } = proxyActivities<OpsActivities>({
  taskQueue: "infra",
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "20 seconds",
  },
});

// Freeze the old Activity commands in their historical scheduling order instead
// of deriving them from the current production collector inventory.
const historicalCollectors = [
  { source: "alerts", collect: collectors.collectOpsAlerts },
  { source: "kubernetes", collect: collectors.collectOpsKubernetes },
  { source: "argocd", collect: collectors.collectOpsArgocd },
  { source: "talos", collect: collectors.collectOpsTalos },
  { source: "ci", collect: collectors.collectOpsCi },
  { source: "github", collect: collectors.collectOpsGithub },
  { source: "renovate", collect: collectors.collectOpsRenovate },
  { source: "linear", collect: collectors.collectOpsLinear },
  { source: "bugsink", collect: collectors.collectOpsBugsink },
  { source: "posthog", collect: collectors.collectOpsPosthog },
  { source: "probes", collect: collectors.collectOpsProbes },
  { source: "logs", collect: collectors.collectOpsLogs },
  { source: "traces", collect: collectors.collectOpsTraces },
  { source: "maintenance", collect: collectors.collectOpsMaintenance },
  { source: "ai", collect: collectors.collectOpsAi },
] as const;

export async function runOpsSnapshot(): Promise<OpsPublishSummary> {
  const traces = patched("ops-traces-collector");
  const outcomes = await Promise.all(
    historicalCollectors.map(
      async ({ source, collect }): Promise<OpsCollectorOutcome> => {
        if (source === "traces" && !traces)
          return {
            source,
            ok: false,
            error: "not collected by this workflow build",
          };
        return { source, ok: true, result: await collect() };
      },
    ),
  );
  return await assembleAndPublishOpsSnapshot({ outcomes });
}
