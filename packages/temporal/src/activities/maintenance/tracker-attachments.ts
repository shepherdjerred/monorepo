import { activityInfo } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { z } from "zod";
import type { AppRouter } from "@shepherdjerred/tracker/contract";

const TrackerErrorDataSchema = z.object({
  code: z.enum(["FORBIDDEN", "BAD_REQUEST"]).optional(),
});

export async function cleanupTrackerAttachments() {
  const runId = activityInfo().workflowExecution?.runId;
  if (runId === undefined) {
    throw ApplicationFailure.nonRetryable(
      "Tracker cleanup requires a Temporal Workflow identity",
      "TrackerCleanupActivityContextError",
    );
  }
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: "http://tracker.tracker.svc.cluster.local:7351/trpc",
      }),
    ],
  });
  try {
    const removed = await client.maintenance.cleanupStaged.mutate(
      {
        actor: {
          key: `runner:temporal:${runId}`,
          kind: "runner",
          name: "Temporal attachment cleanup",
          metadata: {
            harness: "temporal",
            sessionId: runId,
          },
        },
      },
      { signal: AbortSignal.timeout(30_000) },
    );
    return { status: "completed", removed };
  } catch (error) {
    if (error instanceof TRPCClientError) {
      const errorCode = TrackerErrorDataSchema.safeParse(error.data).data?.code;
      if (
        errorCode === "FORBIDDEN" &&
        error.message === "Tracker writes are paused"
      ) {
        return { status: "paused", removed: 0 };
      }
      if (errorCode === "BAD_REQUEST") {
        throw ApplicationFailure.nonRetryable(
          "Tracker rejected the attachment cleanup contract",
          "TrackerCleanupContractError",
        );
      }
    }
    throw error;
  }
}

export const trackerAttachmentActivities = { cleanupTrackerAttachments };
export type TrackerAttachmentActivities = typeof trackerAttachmentActivities;
