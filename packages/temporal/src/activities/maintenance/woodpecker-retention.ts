import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod/v4";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { woodpeckerRetentionConfig } from "#config/woodpecker-retention.ts";
import {
  RetentionRunResultSchema,
  type RetentionApplyInput,
  type RetentionPlanInput,
} from "#shared/woodpecker-retention.ts";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";
import {
  applyRetentionBatch,
  planRetentionBatch,
  retentionProgressFromHeartbeat,
  type RetentionProgress,
} from "./woodpecker-retention-core.ts";
import {
  retentionClient,
  stopOnRetentionContractError,
} from "./woodpecker-retention-runtime.ts";

async function lastScheduledContinuation() {
  const client = await createTemporalReadClient(
    parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]),
  );
  const schedule = await client.schedule
    .getHandle("woodpecker-log-retention-daily")
    .describe();
  const currentId = z
    .object({ workflowId: z.string() })
    .parse(Context.current().info.workflowExecution).workflowId;
  const actions = schedule.info.recentActions.toSorted(
    (a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime(),
  );
  for (const action of actions) {
    if (action.action.workflow.workflowId === currentId) continue;
    const execution = client.workflow.getHandle(
      action.action.workflow.workflowId,
      action.action.workflow.firstExecutionRunId,
    );
    const description = await execution.describe();
    if (description.status.name !== "COMPLETED") continue;
    const result = RetentionRunResultSchema.parse(await execution.result());
    return result.continuation;
  }
  return null;
}

export const woodpeckerRetentionActivities = {
  async initializeWoodpeckerRetention(resumeScheduled: boolean) {
    try {
      return await withBackupActivityHeartbeat(
        Context.current(),
        async (hooks) => {
          const policy = await woodpeckerRetentionConfig();
          const client = await retentionClient(hooks.signal, () => {
            Context.current().heartbeat({ stage: "initialize", receipts: [] });
          });
          const repos = await client.repos();
          const previous = resumeScheduled
            ? await lastScheduledContinuation()
            : null;
          const compatible =
            previous !== null &&
            JSON.stringify(previous.repos) === JSON.stringify(repos);
          return {
            repos,
            cutoff: compatible
              ? previous.cutoff
              : Math.floor(Date.now() / 1000) - policy.days * 86_400,
            cursor: compatible ? previous.cursor : { repoIndex: 0, page: 1 },
            enabled: policy.enabled,
            policy,
          };
        },
        initialProgress("initialize"),
      );
    } catch (error: unknown) {
      return stopOnRetentionContractError(error);
    }
  },

  async planWoodpeckerRetentionBatch(input: RetentionPlanInput) {
    try {
      return await withBackupActivityHeartbeat(
        Context.current(),
        async (hooks) => {
          const client = await retentionClient(hooks.signal, () => {
            Context.current().heartbeat({ stage: "inventory", receipts: [] });
          });
          return await planRetentionBatch(input, client, hooks);
        },
        initialProgress("inventory"),
      );
    } catch (error: unknown) {
      return stopOnRetentionContractError(error);
    }
  },

  async applyWoodpeckerRetentionBatch(input: RetentionApplyInput) {
    try {
      // The TypeScript SDK decodes heartbeatDetails as one payload, not an array.
      const progress = retentionProgressFromHeartbeat(
        Context.current().info.heartbeatDetails,
      );
      return await withBackupActivityHeartbeat(
        Context.current(),
        async (hooks) => {
          let latest = progress;
          const client = await retentionClient(hooks.signal, () => {
            Context.current().heartbeat(latest);
          });
          const enabled = async () => {
            const policy = await woodpeckerRetentionConfig();
            return (
              policy.enabled &&
              input.cutoff <=
                Math.floor(Date.now() / 1000) - policy.days * 86_400
            );
          };
          if (input.cutoff > Math.floor(Date.now() / 1000) - 30 * 86_400)
            throw ApplicationFailure.nonRetryable(
              "Reviewed cutoff would violate minimum 30-day retention",
              "RetentionPolicyError",
            );
          return await applyRetentionBatch(
            { ...input, previous: progress.receipts },
            client,
            {
              ...hooks,
              onProgress: (next) => {
                latest = next;
                hooks.onProgress(next);
              },
            },
            enabled,
          );
        },
        progress,
        true,
      );
    } catch (error: unknown) {
      return stopOnRetentionContractError(error);
    }
  },
};
function initialProgress(stage: string): RetentionProgress {
  return { stage, receipts: [] };
}
export type WoodpeckerRetentionActivities =
  typeof woodpeckerRetentionActivities;
