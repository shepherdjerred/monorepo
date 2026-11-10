import { readRuntimeProof } from "#infrastructure/handoff/runtime-proof.ts";
import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { movieTargetAfter } from "./movie-cursor.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import {
  MovieEditionKeySchema,
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";

export const PERSONAL_MOVIE_DUE_CURSOR = "personal-movie-due-v4:";
const Cursor = z.tuple([z.uuid(), MovieEditionKeySchema]);

/** Scheduling never supplies acquisition birth: the coordinator rereads the actual current choice. */
async function queuePersonalMovieDueV4(
  context: MediaAutomationContext,
  scope: MovieEditionScope,
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error("Personal movie due work lost its original capability");
  const { execution, budget } = invocation;
  execution.assertActive();
  if (!(await context.gates.acquisition())) return;
  const access = await networkMovieAccess(context, [scope.mediaId]);
  if (access === undefined)
    throw new Error(
      "Personal movie due target lost its configured movie access",
    );
  await serializable(context.db, async (tx) => {
    const { target } = await lockMovieCommand(tx, scope);
    if (
      target === null ||
      !target.desiredPresence ||
      !target.monitoring ||
      target.libraryMonitoring ||
      target.profileId === null ||
      target.intentionallyRemovedAt !== null ||
      !(await lockRuntimeAuthority(tx, target.automationEpoch))
    )
      return;
    const reserved = await tx.acquisitionReservation.count({
      where: { mediaId: scope.mediaId, edition: scope.edition },
    });
    if (reserved !== 0) return;
    const profile = await tx.qualityProfile.findUniqueOrThrow({
      where: { id: target.profileId },
      select: { id: true, version: true },
    });
    budget.consume(1);
    const sponsors = await eligibleAcquisitionSponsors(tx, {
      scope,
      access,
      protocol: "movie-v4",
      budget,
    });
    const sponsor = sponsors[0];
    if (sponsor === undefined) return;
    const lease = await readRuntimeProof(tx);
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(
        execution.expiresAtMs,
        lease.expiresAt.getTime(),
        ...sponsors.map((value) => value.freshness.expiresAtMs),
      ),
      guards: [execution, ...sponsors.map((value) => value.freshness)],
    });
    await bindPlexTransactionDeadline(tx, freshness);
    const bucket = Math.floor(execution.observed.wall / 21_600_000);
    await queueOperation(tx, {
      key: `personal-movie-due-v4:${scope.mediaId}:${scope.edition}:${String(target.generation)}:${profile.id}:${String(profile.version)}:${String(bucket)}`,
      kind: "reconcile_movie_edition_v4",
      targetId: scope.mediaId,
      userId: sponsor.choice.actorId,
      budget,
      payload: {
        schemaVersion: 4,
        mediaId: scope.mediaId,
        scope,
        generation: target.generation,
        requestId: sponsor.request.id,
        requestVersion: sponsor.request.version,
        cursor: null,
      },
    });
    freshness.assertActive();
  });
}

/** One exact chosen target per Activity retains the original shared100 and bounded cursor progress. */
export async function sweepPersonalMovieDueV4(
  context: MediaAutomationContext,
  raw: string,
) {
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new Error("Personal movie due sweep lost its original capability");
  invocation.execution.assertActive();
  if (!raw.startsWith(PERSONAL_MOVIE_DUE_CURSOR))
    throw new Error("Personal movie due cursor changed its protocol");
  const encoded = raw.slice(PERSONAL_MOVIE_DUE_CURSOR.length);
  const cursor = encoded === "start" ? null : Cursor.parse(encoded.split(":"));
  const targets = await context.db.mediaIntent.findMany({
    where: {
      desiredPresence: true,
      monitoring: true,
      libraryMonitoring: false,
      media: { kind: "movie" },
      AND: [
        {
          OR: [
            { edition: { not: "default" } },
            {
              edition: "default",
              requests: {
                some: {
                  active: true,
                  direct: true,
                  excluded: false,
                  movieEditionChoiceId: { not: null },
                },
              },
            },
          ],
        },
        movieTargetAfter(cursor),
      ],
    },
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
    take: 2,
    select: { mediaId: true, edition: true, editionRootId: true },
  });
  const target = targets[0];
  if (target !== undefined) {
    const scope = MovieEditionScopeSchema.parse({
      mediaId: target.mediaId,
      rootMediaId: target.editionRootId,
      edition: target.edition,
    });
    try {
      await queuePersonalMovieDueV4(context, scope);
    } catch (error) {
      if (!(error instanceof NativeArchiveScopeProtection)) throw error;
      invocation.execution.assertActive();
      const bucket = Math.floor(
        invocation.execution.observed.wall / 21_600_000,
      );
      const key = `personal-movie-due-protected:${scope.mediaId}:${scope.edition}:${String(bucket)}`;
      await context.db.applicationEvent.upsert({
        where: { dedupeKey: key },
        update: {},
        create: {
          dedupeKey: key,
          mediaId: scope.mediaId,
          kind: "personal_movie_due_protected",
          payload: { schemaVersion: 4, scope, reason: error.code },
        },
      });
    }
  }
  return {
    processed: target === undefined ? 0 : 1,
    nextCursor:
      target !== undefined && targets.length === 2
        ? `${PERSONAL_MOVIE_DUE_CURSOR}${target.mediaId}:${target.edition}`
        : null,
  };
}
