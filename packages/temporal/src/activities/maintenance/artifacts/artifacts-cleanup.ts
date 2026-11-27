import { activityInfo } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";

/** The Service's own DNS name, the internal host class of the one listener. */
const ARTIFACTS_CLEANUP_URL =
  "http://artifacts.artifacts.svc.cluster.local:7440/trpc/maintenance.cleanup";

const CountSchema = z.number().int().nonnegative();

/** `MaintenanceCleanupOutputSchema` in `@shepherdjerred/artifacts/procedures`. */
export const ArtifactsCleanupResultSchema = z.object({
  status: z.enum(["ok", "paused"]),
  expiredSessions: CountSchema,
  purgedBoards: CountSchema,
  deletedBlobs: CountSchema,
  deletedOrphans: CountSchema,
  prunedEvents: CountSchema,
  more: z.boolean(),
});
export type ArtifactsCleanupResult = z.infer<
  typeof ArtifactsCleanupResultSchema
>;

const TrpcResponseSchema = z.object({
  result: z.object({ data: ArtifactsCleanupResultSchema }),
});

export type ArtifactsCleanupActivities = {
  cleanupArtifacts: () => Promise<ArtifactsCleanupResult>;
};

export type ArtifactsHttpFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type CleanupArtifactsDeps = {
  readonly runId: string;
  readonly fetchImpl?: ArtifactsHttpFetcher | undefined;
};

export async function cleanupArtifactsWithDeps(
  deps: CleanupArtifactsDeps,
): Promise<ArtifactsCleanupResult> {
  const fetchImpl: ArtifactsHttpFetcher = deps.fetchImpl ?? fetch;
  const actor = {
    key: `runner:temporal:${deps.runId}`,
    kind: "runner",
    name: "Temporal artifacts cleanup",
    metadata: { harness: "temporal", sessionId: deps.runId },
  };
  const response = await fetchImpl(ARTIFACTS_CLEANUP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "X-Artifacts-Actor": Buffer.from(JSON.stringify(actor)).toString(
        "base64",
      ),
    },
    body: "{}",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const text = await response.text();
    const body = text.slice(0, 200);
    throw new Error(
      `artifacts maintenance.cleanup returned HTTP ${String(response.status)}: ${body}`,
    );
  }
  const body = TrpcResponseSchema.parse(await response.json());
  return body.result.data;
}

/**
 * One bounded cleanup pass. The workflow repeats it while the server reports
 * `more`. The server answers `paused` while its `artifacts-enabled` flag is
 * off, which is an answer, not a failure.
 */
export function cleanupArtifacts(): Promise<ArtifactsCleanupResult> {
  const runId = activityInfo().workflowExecution?.runId;
  if (runId === undefined) {
    throw ApplicationFailure.nonRetryable(
      "Artifacts cleanup requires a Temporal Workflow identity",
      "ArtifactsCleanupActivityContextError",
    );
  }
  return cleanupArtifactsWithDeps({ runId });
}

export const artifactsCleanupActivities: ArtifactsCleanupActivities = {
  cleanupArtifacts,
};
