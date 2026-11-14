import {
  proxyActivities,
  sleep,
  continueAsNew,
  ActivityCancellationType,
} from "@temporalio/workflow";
import type {
  SubtitleMaintenanceActivitiesV1,
  SubtitleMaintenanceJobV1,
  SubtitleMaintenanceModeV1,
} from "@shepherdjerred/media/subtitle-maintenance";
import type {
  MediaFileActivities,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import type {
  MovieNetworkActivitiesV4,
  MovieFileActivitiesV4,
} from "@shepherdjerred/media/movie-lifecycle";
import type { SubtitleReplacementNetworkActivities } from "@shepherdjerred/media/subtitle-replacement";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  SubtitleMaintenanceActivitiesV1 &
    Pick<
      MediaNetworkActivities,
      "findMediaSubtitles" | "finishMediaOperation"
    > &
    Pick<MovieNetworkActivitiesV4, "findMovieSubtitlesV4"> &
    Pick<SubtitleReplacementNetworkActivities, "subtitleReplacementState">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
});
const files = proxyActivities<
  Pick<MediaFileActivities, "installMediaSubtitles"> &
    Pick<MovieFileActivitiesV4, "installMovieSubtitlesV4"> & {
      prepareSubtitleSpeechV1: (input: {
        subtitleId: string;
        operationId: string;
      }) => Promise<{ status: "prepared" | "blocked"; reason?: string }>;
    }
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: "13 hours",
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2 },
});

async function finish(
  job: SubtitleMaintenanceJobV1,
  reason: string | null,
  unknown = false,
) {
  await network.finishMediaOperation({
    operationId: job.operationId,
    status: unknown ? "reconciling" : "completed",
    reason,
  });
}
async function replace(
  job: SubtitleMaintenanceJobV1,
  candidateSubtitleId: string,
) {
  const prepared = await network.beginAutomaticSubtitleReplacementV1({
    job,
    candidateSubtitleId,
  });
  if (prepared === null)
    return finish(job, "subtitle_upgrade_authority_unavailable");
  let approval = await network.approveAutomaticSubtitleReplacementV1({
    job,
    candidateSubtitleId,
    replacementId: prepared.replacementId,
  });
  while (approval === "waiting") {
    await sleep("15 seconds");
    approval = await network.approveAutomaticSubtitleReplacementV1({
      job,
      candidateSubtitleId,
      replacementId: prepared.replacementId,
    });
  }
  if (approval === "protected")
    return finish(job, "subtitle_upgrade_requires_review", true);
  const input = {
    replacementId: prepared.replacementId,
    operationId: prepared.preparationOperationId,
    ...(job.movieScope === undefined ? {} : { movieScope: job.movieScope }),
  };
  let state = await network.subtitleReplacementState(input);
  while (
    state.receiptOutcome === null &&
    ["preparing", "awaiting_review", "applying", "reconciling"].includes(
      state.state,
    )
  ) {
    await sleep("30 seconds");
    state = await network.subtitleReplacementState(input);
  }
  return finish(
    job,
    state.receiptOutcome === "installed"
      ? null
      : "subtitle_upgrade_not_applied",
    state.reservationActive,
  );
}
function subtitleInput(job: SubtitleMaintenanceJobV1) {
  return {
    operationId: job.operationId,
    assetId: job.assetId,
    language: job.language,
    recoveryEpoch: job.recoveryEpoch,
    targetAuthority: job.targetAuthority,
    ...(job.forced === undefined ? {} : { forced: job.forced }),
    ...(job.hearingImpaired === undefined
      ? {}
      : { hearingImpaired: job.hearingImpaired }),
    ...(job.upgradeV1 === undefined ? {} : { upgradeV1: job.upgradeV1 }),
  };
}
async function maintain(job: SubtitleMaintenanceJobV1) {
  const { movieScope } = job;
  const input = subtitleInput(job);
  let found =
    movieScope === undefined
      ? await network.findMediaSubtitles(input)
      : await network.findMovieSubtitlesV4({
          ...input,
          schemaVersion: 4,
          scope: movieScope,
        });
  while (
    found.status === "waiting" &&
    found.reason === "subtitle_browser_pending"
  ) {
    await sleep("30 seconds");
    found =
      movieScope === undefined
        ? await network.findMediaSubtitles(input)
        : await network.findMovieSubtitlesV4({
            ...input,
            schemaVersion: 4,
            scope: movieScope,
          });
  }
  if (found.status !== "found")
    return finish(
      job,
      found.reason,
      found.reason === "subtitle_download_outcome_unknown",
    );
  if (found.subtitleId === null)
    throw new Error("Found subtitle omitted its actual candidate");
  const prepared = await files.prepareSubtitleSpeechV1({
    operationId: job.operationId,
    subtitleId: found.subtitleId,
  });
  if (prepared.status !== "prepared")
    return finish(job, prepared.reason ?? "subtitle_speech_requires_review");
  if (job.upgradeV1 !== undefined) return replace(job, found.subtitleId);
  const installed =
    movieScope === undefined
      ? await files.installMediaSubtitles({
          operationId: job.operationId,
          subtitleId: found.subtitleId,
        })
      : await files.installMovieSubtitlesV4({
          schemaVersion: 4,
          operationId: job.operationId,
          subtitleId: found.subtitleId,
          assetId: job.assetId,
          scope: movieScope,
        });
  return finish(
    job,
    installed.status === "installed"
      ? null
      : (installed.reason ?? installed.status),
  );
}

/** One bounded page per run; native replacement Workflows own all swap,
 * compensation and cleanup effects independently of this recurring planner. */
export async function maintainMediaSubtitlesV1Workflow(input: {
  mode: SubtitleMaintenanceModeV1;
  cursor?: string | null;
}) {
  const page = await network.listSubtitleMaintenanceV1({
    cursor: input.cursor ?? null,
  });
  for (const assetId of page.assetIds) {
    const jobs = await network.prepareSubtitleMaintenanceV1({
      assetId,
      mode: input.mode,
    });
    for (const job of jobs) await maintain(job);
  }
  if (page.nextCursor !== null)
    await continueAsNew<typeof maintainMediaSubtitlesV1Workflow>({
      mode: input.mode,
      cursor: page.nextCursor,
    });
}
