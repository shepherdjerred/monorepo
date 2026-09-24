import {
  ActivityFailure,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";
import type { OpsActivities } from "#activities/ops/ops-activities.ts";
import type {
  OpsCollectorOutcome,
  OpsDigestKind,
  OpsPublishSummary,
} from "#activities/ops/ops-publish.ts";
import type { SourceId } from "@shepherdjerred/ops-model/snapshot.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type CollectorName = {
  [K in keyof OpsActivities]: K extends `collectOps${string}` ? K : never;
}[keyof OpsActivities];

/**
 * One collector Activity per source, so each upstream fails on its own.
 * Every `SourceId` must appear exactly once; the publish Activity rejects a
 * snapshot that misses a source, and a unit test checks this list.
 */
export const OPS_COLLECTORS: readonly (readonly [SourceId, CollectorName])[] = [
  ["alerts", "collectOpsAlerts"],
  ["kubernetes", "collectOpsKubernetes"],
  ["argocd", "collectOpsArgocd"],
  ["talos", "collectOpsTalos"],
  ["ci", "collectOpsCi"],
  ["github", "collectOpsGithub"],
  ["renovate", "collectOpsRenovate"],
  ["linear", "collectOpsLinear"],
  ["bugsink", "collectOpsBugsink"],
  ["posthog", "collectOpsPosthog"],
  ["probes", "collectOpsProbes"],
  ["logs", "collectOpsLogs"],
  ["maintenance", "collectOpsMaintenance"],
  ["ai", "collectOpsAi"],
];

// A snapshot is superseded every five minutes, so a collector gets one quick
// retry and then reports its source as failed rather than holding the run.
const collectors = proxyActivities<OpsActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 seconds",
    maximumInterval: "5 seconds",
  },
});

const { assembleAndPublishOpsSnapshot } = proxyActivities<OpsActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "20 seconds",
  },
});

// The dashboard renders and sends the digest and is idempotent per period,
// so a retried trigger never sends twice.
const { triggerOpsDigest } = proxyActivities<OpsActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

function failureReason(error: unknown): string {
  if (error instanceof ActivityFailure && error.cause !== undefined) {
    return error.cause.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function runOpsSnapshot(): Promise<OpsPublishSummary> {
  const outcomes = await Promise.all(
    OPS_COLLECTORS.map(
      async ([source, collector]): Promise<OpsCollectorOutcome> => {
        try {
          const result = await collectors[collector]();
          return { source, ok: true, result };
        } catch (error: unknown) {
          if (isCancellation(error)) {
            throw error;
          }
          return { source, ok: false, error: failureReason(error) };
        }
      },
    ),
  );
  return await assembleAndPublishOpsSnapshot({ outcomes });
}

export async function runOpsDigest(input: {
  kind: OpsDigestKind;
}): Promise<{ kind: OpsDigestKind }> {
  return await triggerOpsDigest(input.kind);
}
