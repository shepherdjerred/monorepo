import type { MediaActor } from "#application/auth.ts";
import { MovieEditionCommands } from "#infrastructure/movie-editions/commands.ts";
import { chooseMovieEdition } from "#infrastructure/movie-editions/request.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import {
  MovieRequestV4Schema,
  MovieRequestResultV4Schema,
  type MovieRequestV4,
} from "#shared/movie-editions/lifecycle-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";

/** Registered only when all v4 effect consumers are available. v3 stays a distinct protocol. */
export class MovieLifecycleCommands extends MovieEditionCommands {
  requestMovieEditionV4(
    actor: MediaActor,
    key: string,
    raw: MovieRequestV4,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = MovieRequestV4Schema.parse(raw);
    let access: MovieChoiceAccess | undefined;
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_request_v4", input },
        decode: (value) => MovieRequestResultV4Schema.parse(value),
        beforeNewCommand: async () => {
          await beforeNewCommand?.();
          access = await this.configuredMovieChoiceAccess();
        },
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        if (access === undefined)
          throw new Error(
            "Movie v4 access was not captured before its transaction",
          );
        const result = await chooseMovieEdition(tx, actor, input, access);
        freshness = result.freshness;
        const scope = {
          rootMediaId: input.mediaId,
          mediaId: input.mediaId,
          edition: input.selection.edition,
        };
        const defaults = await tx.qualityProfileDefault.findUnique({
          where: { kind: "movie" },
        });
        const epoch = await commandAutomationEpoch(tx);
        const intent = await tx.mediaIntent.update({
          where: {
            mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
          },
          data: {
            desiredPresence: true,
            monitoring: true,
            automationEpoch: epoch,
            profileId: result.intent.profileId ?? defaults?.profileId ?? null,
          },
        });
        const quarantined = await tx.assetCoverage.count({
          where: {
            mediaId: scope.mediaId,
            edition: scope.edition,
            current: true,
            asset: { edition: scope.edition, state: "quarantined" },
          },
        });
        const operationId = await this.enqueue(tx, actor, {
          kind:
            quarantined > 0
              ? "restore_movie_edition_v4"
              : "reconcile_movie_edition_v4",
          mediaId: scope.mediaId,
          generation: intent.generation,
          details: {
            schemaVersion: 4,
            scope,
            requestId: result.request.id,
            requestVersion: result.request.version,
            cursor: null,
          },
        });
        freshness?.assertActive();
        return MovieRequestResultV4Schema.parse({
          schemaVersion: 4,
          mediaId: input.mediaId,
          subjectUserId: input.subjectUserId,
          edition: scope.edition,
          requestId: result.request.id,
          choiceId: result.choice.id,
          state: "queued",
          reason: null,
          operationId,
          applied: {
            mediaVersion: result.media.version,
            targetVersion: intent.version,
            requestVersion: result.request.version,
            choiceRevision: result.choice.choiceRevision,
          },
        });
      },
    );
  }
}
