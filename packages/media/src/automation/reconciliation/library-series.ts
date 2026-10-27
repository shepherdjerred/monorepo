import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { createCoverageActivities } from "./coverage.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { readLibrarySeriesPolicy } from "#infrastructure/acquisition-identity/series-policy.ts";
import { protectLibraryManagement } from "#infrastructure/acquisition-identity/library-policy.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { requireActiveRuntime } from "#automation/runtime.ts";
import { serializable, queueOperation } from "#automation/store.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { MediaError } from "#application/errors.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { MediaItem } from "#generated/prisma/client.ts";
import type { EditionTarget } from "#infrastructure/editions/targets.ts";

export const LIBRARY_SERIES_CURSOR = "library-series:";
type Input = Parameters<MediaNetworkActivities["expandCatalogRequests"]>[0];

/** Existing requester pages retain their contract; the next phase projects household policy without requester rows. */
export async function expandCatalogCoverage(
  initial: MediaAutomationContext,
  input: Input,
) {
  const context = movieManagementContext(initial);
  if (input.cursor?.startsWith(LIBRARY_SERIES_CURSOR) === true)
    return expandLibrarySeries(context, input);
  const result =
    await createCoverageActivities(context).expandCatalogRequests(input);
  return {
    ...result,
    nextCursor: result.nextCursor ?? `${LIBRARY_SERIES_CURSOR}start`,
  };
}

async function expandLibrarySeries(
  initial: MediaAutomationContext,
  input: Input,
) {
  const context = movieManagementContext(initial);
  const execution = context.movieManagement.execution;
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [
      execution,
      {
        assertActive: () => {
          execution.signal.throwIfAborted();
        },
      },
    ],
  });
  const access = await context.plexAccess("show");
  const invocation = {
    freshness,
    access,
    budget: context.movieManagement.budget,
  };
  const runtime = await requireActiveRuntime(context.db);
  if (!runtime.active) return { processed: 0, nextCursor: null };
  const token = input.cursor?.slice(LIBRARY_SERIES_CURSOR.length);
  const cursor = token === "start" ? null : z.uuid().parse(token);
  const episodes = await context.db.mediaItem.findMany({
    where: {
      kind: "episode",
      ...(cursor === null ? {} : { id: { gt: cursor } }),
      OR: [
        { parentId: input.mediaId },
        { parent: { kind: "season", parentId: input.mediaId } },
      ],
    },
    orderBy: { id: "asc" },
    take: 25,
  });
  try {
    await serializable(context.db, async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness);
      const targets = await lockDefaultScopes(
        tx,
        [input.mediaId, ...episodes.map((episode) => episode.id)].map(
          (mediaId) => defaultScope(mediaId),
        ),
        { createMissing: true },
      );
      if (!(await lockRuntimeAuthority(tx, runtime.epoch)))
        protectLibraryManagement();
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: [input.mediaId, ...episodes.map((episode) => episode.id)],
      });
      const policy = await readLibrarySeriesPolicy(
        tx,
        { seriesId: input.mediaId, epoch: runtime.epoch },
        invocation,
      );
      if (policy === null) protectLibraryManagement();
      const currentEpisodes = await tx.mediaItem.findMany({
        where: { id: { in: episodes.map((episode) => episode.id) } },
        orderBy: { id: "asc" },
      });
      for (const episode of currentEpisodes) {
        const selected = targets.find(
          ({ target }) => target.mediaId === episode.id,
        );
        if (selected === undefined)
          throw new Error("Catalog expansion lost its locked episode");
        const target = selected.target;
        const projection = projectableEpisode(
          episode,
          target,
          policy,
          runtime.epoch,
        );
        if (projection === null) continue;
        await tx.mediaIntent.update({
          where: { mediaId_edition: defaultScope(episode.id) },
          data: projection.data,
        });
        await tx.applicationEvent.create({
          data: {
            mediaId: episode.id,
            kind: "library_series_episode_monitored_v1",
            payload: {
              schemaVersion: 1,
              receiptId: policy.receiptId,
              seriesId: policy.seriesId,
              rootGeneration: policy.rootGenerationAtCapture,
              recoveryEpoch: runtime.epoch,
            },
          },
        });
        await queueOperation(tx, {
          key: `library-series:${policy.receiptId}:${String(policy.rootGenerationAtCapture)}:${episode.id}`,
          kind: "reconcile_media",
          targetId: episode.id,
          payload: {
            mediaId: episode.id,
            generation: projection.generation,
          },
        });
      }
      freshness.assertActive();
    });
  } catch (error) {
    if (
      !(error instanceof MediaError) ||
      error.code !== "library_management_unconfirmed"
    )
      throw error;
    return { processed: 0, nextCursor: null };
  }
  return {
    processed: episodes.length,
    nextCursor:
      episodes.length === 25
        ? `${LIBRARY_SERIES_CURSOR}${z.uuid().parse(episodes.at(-1)?.id)}`
        : null,
  };
}

function projectableEpisode(
  episode: MediaItem,
  target: EditionTarget,
  policy: { seriesId: string; profileId: string; includeSpecials: boolean },
  epoch: number,
) {
  if (
    episode.kind !== "episode" ||
    episode.catalogState !== "ready" ||
    episode.seasonNumber === null ||
    episode.episodeNumber === null ||
    (episode.seasonNumber === 0 && !policy.includeSpecials) ||
    target.editionRootId !== policy.seriesId ||
    target.intentionallyRemovedAt !== null ||
    target.libraryMonitoring
  )
    return null;
  if (freshTarget(target))
    return {
      generation: 1,
      data: {
        libraryMonitoring: true,
        desiredPresence: true,
        monitoring: true,
        profileId: policy.profileId,
        generation: 1,
        automationEpoch: epoch,
      },
    };
  return existingTarget(target, policy.profileId, epoch)
    ? { generation: target.generation, data: { libraryMonitoring: true } }
    : null;
}

function freshTarget(target: EditionTarget) {
  return (
    target.generation === 0 &&
    target.automationEpoch === -1 &&
    !target.desiredPresence &&
    !target.monitoring
  );
}
function existingTarget(
  target: EditionTarget,
  profileId: string,
  epoch: number,
) {
  return (
    target.generation > 0 &&
    target.automationEpoch === epoch &&
    target.desiredPresence &&
    target.monitoring &&
    target.profileId === profileId
  );
}

/** Capture before lazy worker loading; only the process-local execution enters this facet. */
export function createCatalogCoverageFacet(context: MediaAutomationContext) {
  return {
    expandCatalogRequests: (input: Input, execution: PlexBindingExecution) => {
      execution.assertActive();
      return expandCatalogCoverage(
        { ...context, plexBindingExecution: () => execution },
        input,
      );
    },
  };
}
