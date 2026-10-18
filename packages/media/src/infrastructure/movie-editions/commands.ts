import type { MediaActor } from "#application/auth.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";
import { needsRestore } from "#infrastructure/locks.ts";
import {
  MovieRequestV3Schema,
  MovieRequestResultV3Schema,
  CancelMovieRequestV3Schema,
  CancelMovieRequestResultV3Schema,
  RevokeMovieEditionChoiceV3Schema,
  RevokeMovieEditionChoiceResultV3Schema,
  type MovieRequestV3,
  type CancelMovieRequestV3,
  type RevokeMovieEditionChoiceV3,
} from "#shared/movie-editions/commands.ts";
import {
  requireMovieProtectionAccess,
  type MovieChoiceAccess,
} from "./access.ts";
import { chooseMovieEdition } from "./request.ts";
import { removeMovieChoice } from "./mutations.ts";
import type { MovieChoiceFreshness } from "./freshness.ts";

export class MovieEditionCommands extends MediaRequestCommands {
  private movieCommandAccess(beforeNewCommand?: () => Promise<void>) {
    let access: MovieChoiceAccess | undefined;
    return {
      prepare: async () => {
        await beforeNewCommand?.();
        access = await this.configuredMovieChoiceAccess();
      },
      read: () => {
        if (access === undefined)
          throw new Error(
            "Movie command access was not captured before its transaction",
          );
        return access;
      },
    };
  }

  requestMovieEdition(
    actor: MediaActor,
    key: string,
    raw: MovieRequestV3,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = MovieRequestV3Schema.parse(raw);
    const access = this.movieCommandAccess(beforeNewCommand);
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_request_v3", input },
        decode: (value) => MovieRequestResultV3Schema.parse(value),
        beforeNewCommand: access.prepare,
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        const result = await chooseMovieEdition(
          tx,
          actor,
          input,
          access.read(),
        );
        freshness = result.freshness;
        const ready = input.selection.edition === "default";
        const operationId = ready
          ? await this.enqueue(tx, actor, {
              kind: (await needsRestore(tx, input.mediaId))
                ? "restore_media"
                : "reconcile_media",
              mediaId: input.mediaId,
              generation: result.intent.generation,
              details: {
                requestId: result.request.id,
                requestVersion: result.request.version,
                cursor: null,
              },
            })
          : null;
        result.freshness?.assertActive();
        return MovieRequestResultV3Schema.parse({
          schemaVersion: 3,
          mediaId: input.mediaId,
          subjectUserId: input.subjectUserId,
          edition: input.selection.edition,
          requestId: result.request.id,
          choiceId: result.choice.id,
          state: ready ? "queued" : "pending",
          reason: ready ? null : "edition_acquisition_not_ready",
          operationId,
          applied: {
            mediaVersion: result.media.version,
            targetVersion: result.intent.version,
            requestVersion: result.request.version,
            choiceRevision: result.choice.choiceRevision,
          },
        });
      },
    );
  }

  cancelMovieEditionRequest(
    actor: MediaActor,
    key: string,
    raw: CancelMovieRequestV3,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = CancelMovieRequestV3Schema.parse(raw);
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_cancel_v3", input },
        decode: (value) => CancelMovieRequestResultV3Schema.parse(value),
        beforeNewCommand,
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        const result = await removeMovieChoice(
          tx,
          actor,
          input,
          requireMovieProtectionAccess(this.settings),
        );
        freshness = result.freshness;
        return CancelMovieRequestResultV3Schema.parse({
          schemaVersion: 3,
          scope: input.scope,
          requestId: input.requestId,
          state: "cancelled",
          choiceId: null,
          applied: {
            targetVersion: result.intent.version,
            requestVersion: result.request.version,
            choiceRevision: result.request.movieEditionChoiceRevision,
          },
        });
      },
    );
  }

  revokeMovieEditionChoice(
    actor: MediaActor,
    key: string,
    raw: RevokeMovieEditionChoiceV3,
    beforeNewCommand?: () => Promise<void>,
  ) {
    const input = RevokeMovieEditionChoiceV3Schema.parse(raw);
    let freshness: MovieChoiceFreshness | null = null;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_revoke_v3", input },
        decode: (value) => RevokeMovieEditionChoiceResultV3Schema.parse(value),
        beforeNewCommand,
        assertCommit: () => freshness?.assertActive(),
      },
      async (tx) => {
        const result = await removeMovieChoice(
          tx,
          actor,
          input,
          requireMovieProtectionAccess(this.settings),
        );
        freshness = result.freshness;
        return RevokeMovieEditionChoiceResultV3Schema.parse({
          schemaVersion: 3,
          scope: input.scope,
          requestId: input.requestId,
          state: "pending_choice",
          choiceId: null,
          applied: {
            targetVersion: result.intent.version,
            requestVersion: result.request.version,
            choiceRevision: result.request.movieEditionChoiceRevision,
          },
        });
      },
    );
  }
}
