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
  parseWorkflowFailureWatchLookbackSince,
  serializedCheckpoint,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";

const HEARTBEAT_INTERVAL_MS = 10_000;

async function runPollWorkflowFailuresImpl(
  checkpoint: WorkflowFailureWatchCheckpoint | undefined,
  lookbackSince: Date,
  onCheckpoint: (checkpoint: WorkflowFailureWatchCheckpoint) => void,
): Promise<PollWorkflowFailuresResult> {
  const client = await createTemporalClient();
  const poster: AlertPoster = createAlertmanagerPoster(
    requiredEnv("ALERTMANAGER_URL"),
  );
  const options = {
    now: new Date(),
    lookbackMs: DEFAULT_LOOKBACK_MS,
    lookbackSince,
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
    const heartbeatDetails: unknown = Context.current().info.heartbeatDetails;
    let checkpoint = parseWorkflowFailureWatchCheckpoint(heartbeatDetails);
    let lookbackSince =
      parseWorkflowFailureWatchLookbackSince(heartbeatDetails) ??
      new Date(start - DEFAULT_LOOKBACK_MS);
    const sendHeartbeat = (): void => {
      Context.current().heartbeat({
        phase: "pollWorkflowFailures",
        elapsedMs: Date.now() - start,
        lookbackSince: lookbackSince.toISOString(),
        checkpoint: serializedCheckpoint(checkpoint),
      });
    };
    sendHeartbeat();
    const heartbeat = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    try {
      return await runPollWorkflowFailuresImpl(
        checkpoint,
        lookbackSince,
        (nextCheckpoint) => {
          checkpoint = nextCheckpoint;
          lookbackSince = nextCheckpoint.lookbackSince ?? lookbackSince;
          sendHeartbeat();
        },
      );
    } finally {
      clearInterval(heartbeat);
    }
  },
};
