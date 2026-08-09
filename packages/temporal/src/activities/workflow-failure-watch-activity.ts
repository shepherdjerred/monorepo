import { Context } from "@temporalio/activity";
import { createTemporalClient } from "#client";
import {
  createAlertmanagerPoster,
  type AlertPoster,
} from "#lib/alertmanager.ts";
import {
  DEFAULT_LOOKBACK_MS,
  pollWorkflowFailuresOnce,
  readTtlMs,
  requiredEnv,
  type PollWorkflowFailuresResult,
} from "./workflow-failure-watch.ts";
import {
  parseWorkflowFailureWatchCheckpoint,
  serializedCheckpoint,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";

const HEARTBEAT_INTERVAL_MS = 10_000;

async function runPollWorkflowFailuresImpl(
  checkpoint: WorkflowFailureWatchCheckpoint | undefined,
  onCheckpoint: (checkpoint: WorkflowFailureWatchCheckpoint) => void,
): Promise<PollWorkflowFailuresResult> {
  const client = await createTemporalClient();
  const poster: AlertPoster = createAlertmanagerPoster(
    requiredEnv("ALERTMANAGER_URL"),
  );
  const options = {
    now: new Date(),
    lookbackMs: DEFAULT_LOOKBACK_MS,
    ttlMs: readTtlMs(),
    onCheckpoint,
    ...(checkpoint === undefined ? {} : { checkpoint }),
  };
  return pollWorkflowFailuresOnce(client, poster, options);
}

export type WorkflowFailureWatchActivities =
  typeof workflowFailureWatchActivities;

export const workflowFailureWatchActivities = {
  async pollWorkflowFailures(): Promise<PollWorkflowFailuresResult> {
    const start = Date.now();
    let checkpoint = parseWorkflowFailureWatchCheckpoint(
      Context.current().info.heartbeatDetails,
    );
    const sendHeartbeat = (): void => {
      Context.current().heartbeat({
        phase: "pollWorkflowFailures",
        elapsedMs: Date.now() - start,
        checkpoint: serializedCheckpoint(checkpoint),
      });
    };
    const heartbeat = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    try {
      return await runPollWorkflowFailuresImpl(checkpoint, (nextCheckpoint) => {
        checkpoint = nextCheckpoint;
        sendHeartbeat();
      });
    } finally {
      clearInterval(heartbeat);
    }
  },
};
