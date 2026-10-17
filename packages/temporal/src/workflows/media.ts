import {
  continueAsNew,
  executeChild,
  proxyActivities,
  sleep,
  CancellationScope,
  ContinueAsNew,
  isCancellation,
  workflowInfo,
} from "@temporalio/workflow";
import type {
  MediaAttemptOperation,
  MediaFileActivities,
  MediaNetworkActivities,
  MediaOperation,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import * as cleanup from "./media/cleanup.ts";
import * as notifications from "./media/notifications.ts";
import * as retention from "./media/retention.ts";

const network = proxyActivities<MediaNetworkActivities>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});
const files = proxyActivities<MediaFileActivities>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  heartbeatTimeout: "1 minute",
  retry: {
    initialInterval: "10 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});
const writes = proxyActivities<
  Pick<
    MediaNetworkActivities,
    "submitMediaTorrent" | "removeMediaTorrent" | "deliverMediaNotification"
  >
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});

async function finish(
  operationId: string,
  result: MediaWorkflowResult,
): Promise<MediaWorkflowResult> {
  await network.finishMediaOperation({
    operationId,
    status: result.status === "blocked" ? "reconciling" : "completed",
    reason: result.reason ?? null,
  });
  return result;
}

function reason(value: string | null | undefined): { reason?: string } {
  return value == null ? {} : { reason: value };
}

export async function reconcileMediaWorkflow(
  input: MediaOperation,
): Promise<MediaWorkflowResult> {
  return withRecoveryCheckpoint(input.operationId, () => reconcile(input));
}

async function reconcile(input: MediaOperation): Promise<MediaWorkflowResult> {
  const result = await network.reconcileMediaIntent(input);
  if (result.status === "acquire") {
    if (result.attemptId === null)
      throw new Error("Acquisition requires an attempt identity");
    return executeChild(acquireMediaReleaseWorkflow, {
      workflowId: `media-acquire-${result.attemptId}`,
      args: [{ operationId: input.operationId, attemptId: result.attemptId }],
    });
  }
  return finish(input.operationId, {
    status: result.status === "available" ? "completed" : result.status,
    ...(result.reason === null ? {} : { reason: result.reason }),
  });
}

export async function acquireMediaReleaseWorkflow(
  input: MediaAttemptOperation & { submitted?: boolean },
): Promise<MediaWorkflowResult> {
  return withRecoveryCheckpoint(input.operationId, () => acquire(input));
}

async function withRecoveryCheckpoint(
  operationId: string,
  work: () => Promise<MediaWorkflowResult>,
): Promise<MediaWorkflowResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ContinueAsNew) throw error;
    await CancellationScope.nonCancellable(() =>
      network.finishMediaOperation({
        operationId,
        status: "reconciling",
        reason: isCancellation(error)
          ? "acquisition_cancelled"
          : "acquisition_failed",
      }),
    );
    throw error;
  }
}

async function acquire(
  input: MediaAttemptOperation & { submitted?: boolean },
): Promise<MediaWorkflowResult> {
  const rollback = await network.publishRolledBackMedia(input);
  if (rollback.status !== "not_applicable")
    return verifyRollback(input, "acquisition_rolled_back", rollback);
  if (input.submitted !== true) {
    const submission = await awaitSubmission(input);
    if (submission.status === "waiting")
      return continueAsNew<typeof acquireMediaReleaseWorkflow>(input);
    if (submission.status !== "submitted")
      return finish(input.operationId, {
        status: submission.status,
        ...(submission.reason === null ? {} : { reason: submission.reason }),
      });
  }
  return awaitDownload(input);
}

async function awaitDownload(
  input: MediaAttemptOperation,
): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 100; poll++) {
    const observation = await network.observeMediaAcquisition(input);
    if (observation.status === "blocked" || observation.status === "obsolete")
      return finish(input.operationId, {
        status: observation.status,
        ...(observation.reason === null ? {} : { reason: observation.reason }),
      });
    if (observation.status === "ready") return publishAcquisition(input);
    await sleep("1 minute");
  }
  return continueAsNew<typeof acquireMediaReleaseWorkflow>({
    ...input,
    submitted: true,
  });
}

async function awaitSubmission(
  input: MediaAttemptOperation,
): ReturnType<MediaNetworkActivities["submitMediaTorrent"]> {
  for (let poll = 0; poll < 100; poll++) {
    const result = await writes.submitMediaTorrent(input);
    if (result.status !== "waiting") return result;
    await sleep("1 minute");
  }
  return { status: "waiting", reason: "provider_deferred" };
}

async function publishAcquisition(
  input: MediaAttemptOperation,
): Promise<MediaWorkflowResult> {
  const staged = await files.inspectAndStageMedia(input);
  if (staged.status !== "staged")
    return finish(input.operationId, {
      status: "blocked",
      ...(staged.reason === undefined ? {} : { reason: staged.reason }),
    });
  const published = await files.promoteMediaFiles(input);
  if (published.status !== "published")
    return finish(input.operationId, {
      status: published.status,
      ...(published.reason === undefined ? {} : { reason: published.reason }),
    });
  for (let poll = 0; poll < 30; poll++) {
    const plex = await network.publishMediaToPlex(input);
    if (plex.status === "available") {
      await network.finalizeMediaAcquisition(input);
      return finish(input.operationId, { status: "completed" });
    }
    if (plex.status === "blocked") {
      return rollbackAcquisition(
        input,
        plex.reason ?? "plex_publication_rejected",
      );
    }
    await sleep("1 minute");
  }
  return rollbackAcquisition(input, "plex_publication_unconfirmed");
}

async function rollbackAcquisition(
  input: MediaAttemptOperation,
  publicationReason: string,
): Promise<MediaWorkflowResult> {
  const result = await files.rollbackMediaPromotion(input);
  if (
    result.status === "rolled_back" ||
    result.reason === "new_publications_quarantined"
  ) {
    return verifyRollback(
      input,
      result.status === "protected"
        ? (result.reason ?? "rollback_protected")
        : publicationReason,
      await network.publishRolledBackMedia(input),
    );
  }
  return finish(input.operationId, {
    status: "blocked",
    reason: result.reason ?? "rollback_protected",
  });
}

async function verifyRollback(
  input: MediaAttemptOperation,
  publicationReason: string,
  initial: Awaited<
    ReturnType<MediaNetworkActivities["publishRolledBackMedia"]>
  >,
): Promise<MediaWorkflowResult> {
  let result = initial;
  for (let poll = 0; poll < 30; poll++) {
    if (result.status === "available")
      return finish(input.operationId, {
        status: "blocked",
        reason: publicationReason,
      });
    if (result.status !== "waiting")
      return finish(input.operationId, {
        status: "blocked",
        reason: result.reason ?? "rollback_publication_unconfirmed",
      });
    await sleep("1 minute");
    result = await network.publishRolledBackMedia(input);
  }
  return finish(input.operationId, {
    status: "blocked",
    reason: "rollback_publication_unconfirmed",
  });
}

export async function acquireMediaSubtitlesWorkflow(input: {
  operationId: string;
  assetId: string;
  language: string;
}): Promise<MediaWorkflowResult> {
  return withRecoveryCheckpoint(input.operationId, () =>
    acquireSubtitles(input),
  );
}

async function acquireSubtitles(input: {
  operationId: string;
  assetId: string;
  language: string;
}): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 28; poll++) {
    const result = await network.findMediaSubtitles(input);
    if (result.status === "found") {
      if (result.subtitleId === null)
        throw new Error("Found subtitles require an asset identity");
      const installed = await files.installMediaSubtitles({
        operationId: input.operationId,
        subtitleId: result.subtitleId,
      });
      return finish(input.operationId, {
        status: installed.status === "installed" ? "completed" : "obsolete",
      });
    }
    if (result.status === "blocked" || result.status === "obsolete")
      return finish(input.operationId, {
        status: result.status,
        ...reason(result.reason),
      });
    await sleep(
      result.reason === "subtitle_browser_pending" ? "30 seconds" : "6 hours",
    );
  }
  return continueAsNew<typeof acquireMediaSubtitlesWorkflow>(input);
}

export const cleanupMediaUpgradeWorkflow = cleanup.cleanupMediaUpgradeWorkflow;

export async function installMediaSubtitleWorkflow(input: {
  operationId: string;
  subtitleId: string;
}): Promise<MediaWorkflowResult> {
  const result = await files.installMediaSubtitles(input);
  return finish(input.operationId, {
    status: result.status === "installed" ? "completed" : "obsolete",
  });
}

export async function maintainMediaTorrentWorkflow(input: {
  operationId: string;
  torrentId: string;
}): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 100; poll++) {
    const result = await network.evaluateMediaSeeding(input);
    if (result.status === "removed")
      return finish(input.operationId, { status: "completed" });
    if (result.status === "removable") {
      const removed = await writes.removeMediaTorrent(input);
      if (removed.status === "removed")
        return finish(input.operationId, { status: "completed" });
    }
    await sleep("10 minutes");
  }
  return continueAsNew<typeof maintainMediaTorrentWorkflow>(input);
}

export const retainMediaWorkflow = retention.retainMediaWorkflow;

export async function restoreMediaWorkflow(
  input: MediaOperation,
): Promise<MediaWorkflowResult> {
  const result = await files.restoreMediaFiles(input);
  if (result.status !== "restored")
    return finish(input.operationId, {
      status: "blocked",
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    });
  for (let poll = 0; poll < 30; poll++) {
    const published = await network.publishRestoredMedia(input);
    if (published.status === "available")
      return finish(input.operationId, { status: "completed" });
    if (published.status === "blocked")
      return finish(input.operationId, {
        status: "blocked",
        ...(published.reason === null ? {} : { reason: published.reason }),
      });
    await sleep("1 minute");
  }
  return finish(input.operationId, {
    status: "blocked",
    reason: "plex_restore_unconfirmed",
  });
}

export const deliverMediaNotificationWorkflow =
  notifications.deliverMediaNotificationWorkflow;

export async function dispatchMediaOutboxWorkflow(): Promise<{
  dispatched: number;
  deferred: number;
}> {
  return network.dispatchMediaOutbox();
}

export async function sweepMediaWorkflow(input: {
  kind: "downloads" | "watch" | "feeds" | "due" | "inventory";
  cursor?: string | null;
  sweepId?: string;
}): Promise<{ processed: number }> {
  let cursor = input.cursor ?? null;
  const sweepId = input.sweepId ?? workflowInfo().runId;
  let processed = 0;
  for (let page = 0; page < 20; page++) {
    const result = await network.sweepMediaWork({
      kind: input.kind,
      cursor,
      sweepId,
    });
    processed += result.processed;
    cursor = result.nextCursor;
    if (cursor === null) return { processed };
  }
  return continueAsNew<typeof sweepMediaWorkflow>({
    kind: input.kind,
    cursor,
    sweepId,
  });
}

export async function expandMediaRequestWorkflow(input: {
  operationId: string;
  requestId: string;
  requestVersion: number;
  cursor: string | null;
}): Promise<void> {
  let cursor = input.cursor;
  for (let page = 0; page < 20; page++) {
    const result = await network.expandMediaRequest({ ...input, cursor });
    cursor = result.nextCursor;
    if (cursor === null) {
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: "completed",
        reason: null,
      });
      return;
    }
  }
  return continueAsNew<typeof expandMediaRequestWorkflow>({ ...input, cursor });
}

export async function refreshMediaCatalogWorkflow(input: {
  operationId: string;
  mediaId: string;
  cursor: string | null;
}): Promise<void> {
  let cursor = input.cursor;
  for (let page = 0; page < 20; page++) {
    const result = await network.refreshMediaCatalog({ ...input, cursor });
    cursor = result.nextCursor;
    if (cursor === null) {
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: "completed",
        reason: null,
      });
      return;
    }
  }
  return continueAsNew<typeof refreshMediaCatalogWorkflow>({
    ...input,
    cursor,
  });
}

export async function expandCatalogRequestsWorkflow(input: {
  operationId: string;
  mediaId: string;
  cursor: string | null;
}): Promise<void> {
  let cursor = input.cursor;
  for (let page = 0; page < 20; page++) {
    const result = await network.expandCatalogRequests({ ...input, cursor });
    cursor = result.nextCursor;
    if (cursor === null) {
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: "completed",
        reason: null,
      });
      return;
    }
  }
  return continueAsNew<typeof expandCatalogRequestsWorkflow>({
    ...input,
    cursor,
  });
}
