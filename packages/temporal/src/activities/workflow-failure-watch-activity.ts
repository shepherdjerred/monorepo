import { Context } from "@temporalio/activity";
import { createTemporalVisibilityClient } from "#client";
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
  parseWorkflowFailureWatchCheckpoints,
  parseWorkflowFailureWatchLookbackSince,
  serializedCheckpoints,
  serializedCheckpoint,
  type WorkflowFailureWatchCheckpoints,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";
import {
  parseLegacyTemporalNamespace,
  parseTemporalNamespace,
  temporalNamespacesForMonitoring,
  type AnyTemporalNamespace,
} from "#shared/temporal-namespace.ts";

const HEARTBEAT_INTERVAL_MS = 10_000;

async function runPollWorkflowFailuresImpl(
  checkpoints: WorkflowFailureWatchCheckpoints,
  lookbackSince: Date,
  onCheckpoint: (
    namespace: AnyTemporalNamespace,
    checkpoint: WorkflowFailureWatchCheckpoint,
  ) => void,
): Promise<PollWorkflowFailuresResult> {
  const poster: AlertPoster = createAlertmanagerPoster(
    requiredEnv("ALERTMANAGER_URL"),
  );
  const namespaces = temporalNamespacesForMonitoring(
    parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]),
    parseLegacyTemporalNamespace(Bun.env["TEMPORAL_LEGACY_NAMESPACE"]),
  );
  const aggregate: PollWorkflowFailuresResult = {
    scanned: 0,
    alerted: 0,
    errored: 0,
  };
  for (const namespace of namespaces) {
    const client = await createTemporalVisibilityClient(namespace);
    const checkpoint = checkpoints[namespace];
    const result = await pollWorkflowFailuresOnce(client, poster, {
      namespace,
      now: new Date(),
      lookbackMs: DEFAULT_LOOKBACK_MS,
      lookbackSince,
      ttlMs: readTtlMs(),
      onCheckpoint: (nextCheckpoint) => {
        onCheckpoint(namespace, nextCheckpoint);
      },
      ...(checkpoint === undefined ? {} : { checkpoint }),
    });
    aggregate.scanned += result.scanned;
    aggregate.alerted += result.alerted;
    aggregate.errored += result.errored;
  }
  return aggregate;
}

export type WorkflowFailureWatchActivities =
  typeof workflowFailureWatchActivities;

export const workflowFailureWatchActivities = {
  async pollWorkflowFailures(): Promise<PollWorkflowFailuresResult> {
    const start = Date.now();
    const heartbeatDetails: unknown = Context.current().info.heartbeatDetails;
    const checkpoints: WorkflowFailureWatchCheckpoints =
      parseWorkflowFailureWatchCheckpoints(heartbeatDetails);
    const legacyCheckpoint =
      parseWorkflowFailureWatchCheckpoint(heartbeatDetails);
    if (legacyCheckpoint !== undefined && checkpoints.prod === undefined) {
      checkpoints.prod = legacyCheckpoint;
    }
    let lookbackSince =
      parseWorkflowFailureWatchLookbackSince(heartbeatDetails) ??
      new Date(start - DEFAULT_LOOKBACK_MS);
    const sendHeartbeat = (): void => {
      Context.current().heartbeat({
        phase: "pollWorkflowFailures",
        elapsedMs: Date.now() - start,
        lookbackSince: lookbackSince.toISOString(),
        checkpoint: serializedCheckpoint(checkpoints.prod),
        checkpoints: serializedCheckpoints(checkpoints),
      });
    };
    sendHeartbeat();
    const heartbeat = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    try {
      return await runPollWorkflowFailuresImpl(
        checkpoints,
        lookbackSince,
        (namespace, nextCheckpoint) => {
          checkpoints[namespace] = nextCheckpoint;
          lookbackSince = nextCheckpoint.lookbackSince ?? lookbackSince;
          sendHeartbeat();
        },
      );
    } finally {
      clearInterval(heartbeat);
    }
  },
};
