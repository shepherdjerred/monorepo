import type { MediaActor } from "#application/auth.ts";
import { MoviePublicCommandsV4 } from "./public/public-commands.ts";
import { chooseMovieEdition } from "#infrastructure/movie-editions/request.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import {
  MovieRequestV4Schema,
  MovieRequestResultV4Schema,
  type MovieRequestV4,
  MovieLifecycleCommandV4Schema,
  MovieLifecycleResultV4Schema,
  type MovieLifecycleCommandV4,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { queueRequestedMovieRetryV4 } from "./retry/retry-command.ts";
import { applyMovieActionV4 } from "./public/public-action.ts";
import { movieHttpInvocationV4 } from "./public/public-action-authority.ts";
import { MediaError } from "#application/errors.ts";
import { queueRequestedMovieCaptionsV4 } from "./requested-captions.ts";
import { captureMovieActionAccessV4 } from "./public/public-access.ts";

/** Registered only when all v4 effect consumers are available. v3 stays a distinct protocol. */
export class MovieLifecycleCommands extends MoviePublicCommandsV4 {
  executeMovieLifecycleV4(
    actor: MediaActor,
    key: string,
    raw: MovieLifecycleCommandV4,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = MovieLifecycleCommandV4Schema.parse(raw);
    if (input.command.action === "retry")
      return this.retryMovieEditionV4(actor, key, input, beforeNewCommand);
    const budget = new PublicationAuthorityReadBudget();
    const invocation = movieHttpInvocationV4(budget);
    let access:
      Awaited<ReturnType<typeof captureMovieActionAccessV4>> | undefined;
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_lifecycle_v4", input },
        decode: (value) => MovieLifecycleResultV4Schema.parse(value),
        beforeNewCommand: async () => {
          await beforeNewCommand?.();
          access = await captureMovieActionAccessV4(
            this.settings,
            () => this.configuredMovieChoiceAccess(),
            input.command.action,
          );
        },
        assertCommit: () => {
          invocation.execution.assertActive();
          freshness?.assertActive();
        },
      },
      async (tx) => {
        if (access === undefined)
          throw new Error("Movie lifecycle access missing");
        const result = await applyMovieActionV4(tx, actor, input, {
          access: access.protection,
          movieAccess: access.choice,
          invocation,
          keepDays: this.settings.keepDays,
        });
        freshness = result.freshness;
        const operationId =
          result.command === null
            ? undefined
            : await this.enqueue(tx, actor, {
                ...result.command,
                createdAt: new Date(),
                availableAt: new Date(),
              });
        return MovieLifecycleResultV4Schema.parse({
          schemaVersion: 4,
          scope: input.scope,
          result: {
            ...(operationId === undefined ? {} : { operationId }),
            status: operationId === undefined ? "completed" : "queued",
            version: result.applied.mediaVersion,
          },
          applied: result.applied,
        });
      },
    );
  }

  retryMovieEditionV4(
    actor: MediaActor,
    key: string,
    raw: MovieLifecycleCommandV4,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = MovieLifecycleCommandV4Schema.parse(raw);
    const budget = new PublicationAuthorityReadBudget();
    let access: MovieChoiceAccess | undefined;
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_retry_v4", input },
        decode: (value) => MovieLifecycleResultV4Schema.parse(value),
        beforeNewCommand: async () => {
          await beforeNewCommand?.();
          access = await this.configuredMovieChoiceAccess();
        },
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        if (access === undefined)
          throw new Error(
            "Movie retry access was not captured before its transaction",
          );
        const queued = await queueRequestedMovieRetryV4(
          tx,
          { actor, command: input, access, budget },
          (db, command) =>
            this.enqueue(db, actor, {
              kind: "reconcile_movie_edition_v4",
              ...command,
              createdAt: new Date(),
              availableAt: new Date(),
            }),
        );
        freshness = queued.freshness;
        return MovieLifecycleResultV4Schema.parse({
          schemaVersion: 4,
          scope: input.scope,
          result: {
            operationId: queued.operationId,
            status: "queued",
            version: queued.applied.mediaVersion,
          },
          applied: queued.applied,
        });
      },
    );
  }

  requestMovieEditionV4(
    actor: MediaActor,
    key: string,
    raw: MovieRequestV4,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = MovieRequestV4Schema.parse(raw);
    const budget = new PublicationAuthorityReadBudget();
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
        const result = await chooseMovieEdition(tx, actor, input, {
          ...access,
          protocol: 4,
          budget,
        });
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
        if (epoch < 0)
          throw new MediaError(
            "runtime_protected",
            "Media automation is paused",
            409,
          );
        const profileId = result.intent.profileId ?? defaults?.profileId;
        if (profileId === undefined)
          throw new MediaError(
            "quality_profile_required",
            "Select a movie quality profile before requesting",
            409,
          );
        const intent = await tx.mediaIntent.update({
          where: {
            mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
          },
          data: {
            desiredPresence: true,
            monitoring: true,
            automationEpoch: epoch,
            profileId,
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
          createdAt: new Date(),
          availableAt: new Date(),
          details: {
            schemaVersion: 4,
            scope,
            requestId: result.request.id,
            requestVersion: result.request.version,
            cursor: null,
          },
        });
        await queueRequestedMovieCaptionsV4(
          tx,
          { scope, epoch, access },
          budget,
        );
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
