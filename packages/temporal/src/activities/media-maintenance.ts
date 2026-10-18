import { ApplicationFailure, Context, heartbeat } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";
import type {
  PlexExclusionNetworkActivities,
  PlexExclusionFileActivities,
} from "@shepherdjerred/media/plex-exclusion";
import {
  createPlexExclusionNetworkRuntime,
  createPlexExclusionFileRuntime,
} from "@shepherdjerred/media/automation/plex-exclusion";

let networkRuntime:
  ReturnType<typeof createPlexExclusionNetworkRuntime> | undefined;
let fileRuntime: ReturnType<typeof createPlexExclusionFileRuntime> | undefined;
function checkpoint(): Promise<void> {
  if (Context.current().cancellationSignal.aborted)
    throw new CancelledFailure("Plex exclusion activity cancelled");
  heartbeat();
  return Promise.resolve();
}
async function network() {
  networkRuntime ??= createPlexExclusionNetworkRuntime(Bun.env, checkpoint);
  try {
    return await networkRuntime;
  } catch (error) {
    networkRuntime = undefined;
    throw error;
  }
}
async function files() {
  fileRuntime ??= createPlexExclusionFileRuntime(Bun.env, checkpoint);
  try {
    return await fileRuntime;
  } catch (error) {
    fileRuntime = undefined;
    throw error;
  }
}
async function sanitized(action: () => Promise<unknown>): Promise<void> {
  try {
    await checkpoint();
    await action();
    await checkpoint();
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    throw ApplicationFailure.create({
      message: "Plex exclusion activity requires reconciliation",
      type: "PlexExclusionActivityFailure",
    });
  }
}

export const plexExclusionNetworkWorkerActivities: PlexExclusionNetworkActivities =
  {
    preparePlexExclusionTopology: (input) =>
      sanitized(async () => {
        const runtime = await network();
        await runtime.activities.preparePlexExclusionTopology(input);
      }),
    validatePlexExclusionExecution: (input) =>
      sanitized(async () => {
        const runtime = await network();
        await runtime.activities.validatePlexExclusionExecution(input);
      }),
    finishPlexExclusion: (input) =>
      sanitized(async () => {
        const runtime = await network();
        await runtime.activities.finishPlexExclusion(input);
      }),
    recordPlexExclusionIntervention: (input) =>
      sanitized(async () => {
        const runtime = await network();
        await runtime.activities.recordPlexExclusionIntervention(input);
      }),
    async reconcilePlexExclusionScan(input) {
      try {
        await checkpoint();
        const runtime = await network();
        const result =
          await runtime.activities.reconcilePlexExclusionScan(input);
        await checkpoint();
        return result;
      } catch (error) {
        if (error instanceof CancelledFailure) throw error;
        throw ApplicationFailure.create({
          message: "Plex scan requires reconciliation",
          type: "PlexExclusionActivityFailure",
        });
      }
    },
  };
export const plexExclusionFileWorkerActivities: PlexExclusionFileActivities = {
  preparePlexExclusionFiles: (input) =>
    sanitized(async () => {
      const runtime = await files();
      await runtime.activities.preparePlexExclusionFiles(input);
    }),
  stagePlexExclusionFiles: (input) =>
    sanitized(async () => {
      const runtime = await files();
      await runtime.activities.stagePlexExclusionFiles(input);
    }),
  cleanupPlexExclusionFiles: (input) =>
    sanitized(async () => {
      const runtime = await files();
      await runtime.activities.cleanupPlexExclusionFiles(input);
    }),
};
