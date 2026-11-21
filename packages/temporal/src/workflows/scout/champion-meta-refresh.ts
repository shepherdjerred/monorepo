import { proxyActivities } from "@temporalio/workflow";
import type {
  ChampionMetaActivities,
  ChampionMetaRefreshResult,
  ChampionMetaWorkflowInput,
} from "#activities/scout/champion-meta-refresh.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { refreshChampionMeta } = proxyActivities<ChampionMetaActivities>({
  taskQueue: TASK_QUEUES.SCOUT,
  // Clone, root install, then up to ~170 paced API reads (the meta API allows
  // 120 requests a minute per IP) and a PR.
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 minutes",
    backoffCoefficient: 2,
    maximumInterval: "15 minutes",
  },
});

export async function runScoutChampionMetaRefresh(
  input: ChampionMetaWorkflowInput,
): Promise<ChampionMetaRefreshResult> {
  return await refreshChampionMeta(input);
}
