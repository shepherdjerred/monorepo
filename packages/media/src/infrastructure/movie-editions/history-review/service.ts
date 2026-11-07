import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { requireOwner } from "#application/errors.ts";
import {
  MediaCommandBase,
  type MediaCommandSettings,
} from "#infrastructure/command-base.ts";
import {
  PrepareMovieHistoryV3Schema,
  RespondMovieHistoryV3Schema,
  ReleaseMovieHistoryV3Schema,
  MovieHistoryStoredResponseV3Schema,
  MovieHistoryCommandResultV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { lockMovieHistoryV3, movieHistoryConflict } from "./locks.ts";
import { snapshotMovieHistoryV3 } from "./snapshot.ts";
import {
  currentMovieHistoryOwnerV3,
  currentMovieHistoryReviewV3,
  movieHistoryHash,
} from "./current.ts";
import { validateMovieHistoryConsentV3 } from "./consent.ts";
import { movieHistoryViewV3 } from "./view.ts";
import { releaseMovieHistoryV3 } from "./release.ts";
import { reserveMovieHistorySqlV3 } from "./read-costs.ts";
import { bindMovieHistoryDeadlineV3 } from "./deadline.ts";
import type { MovieHistoryAdministration } from "#application/movie-history-ports.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieHistoryDiscoveryV3Schema } from "#shared/movie-editions/history-review-views-v3.ts";
import { discoverMovieHistoryV3, movieHistoryContextV3 } from "./discovery.ts";

type Guard = { expiresAtMs: number; assertActive: () => void };
type Invocation = {
  access: MovieChoiceAccess;
  budget: PublicationAuthorityReadBudget;
  guards: Guard[];
  observed: { wall: number; monotonic: number };
};
type Options = {
  budget?: PublicationAuthorityReadBudget;
  refreshManaged?: (actor: MediaActor, subjectUserId: string) => Promise<void>;
};

/** Internal explicit cut protocol. Existing review routes keep their literal v1/v2 contracts. */
export class PrismaMovieHistoryReviews
  extends MediaCommandBase
  implements MovieHistoryAdministration
{
  constructor(
    private readonly db: Database,
    settings: MediaCommandSettings,
    private readonly options: Options = {},
  ) {
    super(db, settings);
  }

  async context(actor: MediaActor, scope: MovieEditionScope) {
    return this.db.$transaction(
      (tx) => movieHistoryContextV3(tx, { actorId: actor.id, scope }),
      { isolationLevel: "Serializable", timeout: 15_000 },
    );
  }

  async list(
    actor: MediaActor,
    input: z.input<typeof MovieHistoryDiscoveryV3Schema>,
  ) {
    const budget = this.options.budget ?? new PublicationAuthorityReadBudget();
    const access = await this.configuredMovieChoiceAccess();
    return this.db.$transaction(
      (tx) =>
        discoverMovieHistoryV3(
          tx,
          { actorId: actor.id, query: input, access },
          budget,
        ),
      { isolationLevel: "Serializable", timeout: 15_000 },
    );
  }

  async detail(actor: MediaActor, id: string) {
    const access = await this.configuredMovieChoiceAccess();
    return this.db.$transaction(
      (tx) => movieHistoryViewV3(tx, { actorId: actor.id, id, access }),
      { isolationLevel: "Serializable", timeout: 15_000 },
    );
  }

  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof PrepareMovieHistoryV3Schema>,
  ) {
    requireOwner(actor);
    const input = PrepareMovieHistoryV3Schema.parse(raw);
    return this.run(
      actor,
      key,
      { kind: "prepare_movie_history_v3", input },
      async (tx, invocation) => {
        await lockMovieHistoryV3(tx, input.scope);
        await currentMovieHistoryOwnerV3(tx, actor.id);
        const captured = await snapshotMovieHistoryV3(
          tx,
          { scope: input.scope, access: invocation.access },
          invocation.budget,
        );
        const scope = captured.scope;
        if (
          scope.media.version !== input.expected.mediaVersion ||
          scope.target.version !== input.expected.targetVersion ||
          scope.hold.version !== input.expected.holdVersion ||
          movieHistoryHash(scope.definition) !==
            movieHistoryHash(input.expected.definition)
        )
          throw movieHistoryConflict(
            "Inspect the exact current movie, cut, definition and hold before review",
          );
        invocation.guards.push(captured.freshness);
        reserveMovieHistorySqlV3(invocation.budget, {
          phase: "prepare",
          scope,
          reads: captured.sql,
          responses: [],
        });
        await bindMovieHistoryDeadlineV3(tx, invocation);
        const createdAt = new Date();
        const review = await tx.recoveryReview.create({
          data: {
            actorId: actor.id,
            recoveryEpoch: scope.recoveryEpoch,
            runtimeVersion: scope.runtimeVersion,
            scope: z.record(z.string(), z.json()).parse(nativeJson(scope)),
            scopeHash: movieHistoryHash(scope),
            createdAt,
            expiresAt: new Date(createdAt.getTime() + 7 * 86_400_000),
          },
        });
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            mediaId: input.scope.mediaId,
            kind: "movie_history_review_captured_v3",
            dedupeKey: `movie-history-review-v3:${review.id}`,
            payload: {
              schemaVersion: 3,
              reviewId: review.id,
              scope: input.scope,
              scopeRaw: canonicalJson(nativeJson(scope)),
              scopeHash: review.scopeHash,
            },
          },
        });
        return {
          recoveryReviewId: review.id,
          status: "completed",
          version: review.version,
        };
      },
    );
  }

  async respond(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof RespondMovieHistoryV3Schema>,
  ) {
    const input = RespondMovieHistoryV3Schema.parse(raw);
    return this.run(
      actor,
      key,
      { kind: "respond_movie_history_v3", input: { id, ...input } },
      async (tx, invocation) => {
        const current = await currentMovieHistoryReviewV3(
          tx,
          { id, access: invocation.access },
          invocation.budget,
        );
        const { review, scope } = current;
        if (
          movieHistoryHash(input.scope) !== movieHistoryHash(scope.scope) ||
          input.scopeHash !== review.scopeHash ||
          movieHistoryHash(input.definition) !==
            movieHistoryHash(scope.definition)
        )
          throw movieHistoryConflict(
            "Respond to the visible cut and exact captured definition",
          );
        const expected = scope.users.find(
          (subject) => subject.id === input.subjectUserId,
        )?.claimAcknowledgements;
        if (
          expected === undefined ||
          movieHistoryHash(expected) !==
            movieHistoryHash(input.claimAcknowledgements)
        )
          throw movieHistoryConflict(
            "Acknowledge every exact selected-cut legacy claim for this person",
          );
        const consent = await validateMovieHistoryConsentV3(
          tx,
          { scope, response: input, actorId: actor.id },
          invocation.budget,
        );
        invocation.guards.push(current.freshness, consent.freshness);
        if (
          await tx.recoveryResponse.findUnique({
            where: {
              reviewId_userId: { reviewId: id, userId: input.subjectUserId },
            },
          })
        )
          throw movieHistoryConflict(
            "This immutable response already exists; prepare a fresh review to change it",
          );
        const response = MovieHistoryStoredResponseV3Schema.parse({
          ...input,
          authority: consent.authority,
        });
        reserveMovieHistorySqlV3(invocation.budget, {
          phase: "respond",
          scope,
          reads: current.sql,
          responses: [response],
        });
        await bindMovieHistoryDeadlineV3(tx, invocation);
        await tx.recoveryResponse.create({
          data: {
            reviewId: id,
            userId: input.subjectUserId,
            actorId: actor.id,
            response: z.record(z.string(), z.json()).parse(response),
          },
        });
        await tx.recoveryReview.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return {
          recoveryReviewId: id,
          status: "completed",
          version: review.version + 1,
        };
      },
    );
  }

  async release(
    actor: MediaActor,
    key: string,
    id: string,
    raw: z.input<typeof ReleaseMovieHistoryV3Schema>,
  ) {
    requireOwner(actor);
    const input = ReleaseMovieHistoryV3Schema.parse(raw);
    return this.run(
      actor,
      key,
      { kind: "release_movie_history_v3", input: { id, ...input } },
      async (tx, invocation) => {
        const current = await currentMovieHistoryReviewV3(
          tx,
          { id, access: invocation.access },
          invocation.budget,
        );
        await currentMovieHistoryOwnerV3(tx, actor.id);
        const result = await releaseMovieHistoryV3(
          tx,
          { actorId: actor.id, input, current, observed: invocation.observed },
          invocation.budget,
        );
        invocation.guards.push(current.freshness, ...result.guards);
        return result.result;
      },
    );
  }

  private async run(
    actor: MediaActor,
    key: string,
    command: { kind: string; input: unknown },
    work: (
      tx: Prisma.TransactionClient,
      invocation: Invocation,
    ) => Promise<Prisma.InputJsonObject>,
  ) {
    const observed = { wall: Date.now(), monotonic: performance.now() };
    const initial = plexBindingFreshness({
      observed,
      expiresAtMs: observed.wall + 60_000,
      guards: [],
    });
    const budget = this.options.budget ?? new PublicationAuthorityReadBudget();
    let access: MovieChoiceAccess | undefined;
    let commit: Guard | undefined;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command,
        decode: (value) => MovieHistoryCommandResultV3Schema.parse(value),
        beforeNewCommand: async () => {
          access = await this.configuredMovieChoiceAccess();
          if (command.kind === "prepare_movie_history_v3")
            await this.refreshManaged(actor);
        },
        assertCommit: () => commit?.assertActive(),
      },
      async (tx) => {
        if (access === undefined)
          throw new Error(
            "Movie history invocation lost its captured configuration",
          );
        await bindPlexTransactionDeadline(tx, initial);
        const invocation: Invocation = {
          access,
          budget,
          guards: [initial],
          observed,
        };
        const result = await work(tx, invocation);
        commit = plexBindingFreshness({
          observed,
          expiresAtMs: Math.min(
            observed.wall + 60_000,
            ...invocation.guards.map((guard) => guard.expiresAtMs),
          ),
          guards: invocation.guards,
        });
        await bindPlexTransactionDeadline(tx, commit);
        return result;
      },
    );
  }

  private async refreshManaged(actor: MediaActor) {
    if (this.options.refreshManaged === undefined) return;
    const rows = await this.db.plexIdentityMapping.findMany({
      where: {
        kind: "managed",
        OR: [
          { verifiedAt: null },
          { verifiedAt: { lt: new Date(Date.now() - 300_000) } },
          { verifiedAt: { gt: new Date() } },
        ],
      },
      select: { userId: true },
      orderBy: { userId: "asc" },
      take: 101,
    });
    if (rows.length > 100)
      throw movieHistoryConflict(
        "Managed identity refresh exceeds its native household bound",
      );
    for (const row of rows)
      await this.options.refreshManaged(actor, row.userId);
  }
}
