import { proxyActivities } from "@temporalio/workflow";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export type ScoutCompetitionUpdateDispatchResult = {
  succeeded: number;
  failed: number;
};

type ScoutCompetitionUpdateActivities = {
  runScheduledCompetitionUpdates: () => Promise<ScoutCompetitionUpdateDispatchResult>;
};

const ACTIVITY_OPTIONS = {
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
} as const;

const betaActivities = proxyActivities<ScoutCompetitionUpdateActivities>({
  ...ACTIVITY_OPTIONS,
  taskQueue: TASK_QUEUES.SCOUT_BETA,
});

const prodActivities = proxyActivities<ScoutCompetitionUpdateActivities>({
  ...ACTIVITY_OPTIONS,
  taskQueue: TASK_QUEUES.SCOUT_PROD,
});

/**
 * Ask each deployed Scout runtime to dispatch the competition updates due in
 * its own database. Temporal owns the recurring trigger and retries; the
 * stage-local activity workers retain the Discord and database credentials.
 */
export async function runScoutCompetitionUpdatesWorkflow(): Promise<{
  beta: ScoutCompetitionUpdateDispatchResult;
  prod: ScoutCompetitionUpdateDispatchResult;
}> {
  const [beta, prod] = await Promise.all([
    betaActivities.runScheduledCompetitionUpdates(),
    prodActivities.runScheduledCompetitionUpdates(),
  ]);
  return { beta, prod };
}
