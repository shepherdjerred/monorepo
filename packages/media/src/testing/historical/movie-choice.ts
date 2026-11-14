import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { needsRestore } from "#infrastructure/locks.ts";
import {
  MovieRequestV3Schema,
  MovieRequestResultV3Schema,
  type MovieRequestV3,
} from "#shared/movie-editions/commands.ts";
import { chooseHistoricalMovieEdition } from "./movie-request.ts";

/** Exact historical command envelope with the pre-household request producer.
 * Current runtime commands never dispatch here or inspect schemas to fall back. */
class HistoricalMovieCommands extends MediaCommandBase {
  requestMovieEdition(actor: MediaActor, key: string, raw: MovieRequestV3) {
    const input = MovieRequestV3Schema.parse(raw);
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { protocol: "movie_request_v3", input },
        decode: (value) => MovieRequestResultV3Schema.parse(value),
      },
      async (tx) => {
        const result = await chooseHistoricalMovieEdition(
          tx,
          actor,
          input,
          await this.configuredMovieChoiceAccess(),
        );
        const operationId = await this.enqueue(tx, actor, {
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
        });
        result.freshness?.assertActive();
        return MovieRequestResultV3Schema.parse({
          schemaVersion: 3,
          mediaId: input.mediaId,
          subjectUserId: input.subjectUserId,
          edition: input.selection.edition,
          requestId: result.request.id,
          choiceId: result.choice.id,
          state: "queued",
          reason: null,
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
}

export async function chooseHistoricalTestMovieEdition(
  db: Database,
  input: { actor: MediaActor; mediaId: string; access: MovieChoiceAccess },
) {
  const app = new PrismaMediaApplication(db, { keepDays: 7, ...input.access });
  const context = await app.getMovieEditionContext(
    input.actor,
    input.mediaId,
    input.actor.id,
  );
  const selected = context.options.find(
    (option) => option.edition === "default",
  );
  if (selected === undefined)
    throw new Error("Historical default edition absent");
  const key = crypto.randomUUID();
  const command = MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: input.mediaId,
    subjectUserId: input.actor.id,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: selected.targetVersion,
      definition: selected.storedDefinition,
      request:
        selected.request === null
          ? null
          : {
              id: selected.request.id,
              version: selected.request.version,
              choiceRevision: selected.request.choiceRevision,
            },
    },
    selection: {
      edition: "default",
      definitionVersion: selected.definitionVersion,
      definitionDigest: selected.definitionDigest,
      registryVersion: context.registryVersion,
    },
    // Literal pre-household options, without a new keeping-policy claim.
    options: { subtitleLanguages: [] },
  });
  const historical = new HistoricalMovieCommands(db, {
    keepDays: 7,
    ...input.access,
  });
  const result = await historical.requestMovieEdition(
    input.actor,
    key,
    command,
  );
  return { app, context, result, key, command };
}
