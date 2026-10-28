import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { MovieRequestV4Schema } from "#shared/movie-editions/lifecycle-v4.ts";
import { z } from "zod";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

/** Real v4 consent, current revisions, configured library and transactional outbox. */
export async function requestTestMovieV4(
  db: Database,
  actor: MediaActor,
  mediaId: string,
  selection:
    MovieEditionKey | { edition: MovieEditionKey; subtitleLanguages: string[] },
) {
  const { edition, subtitleLanguages } =
    typeof selection === "string"
      ? { edition: selection, subtitleLanguages: ["en", "zh-Hans"] }
      : selection;
  const commands = new MovieLifecycleCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  const reader = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  const context = await reader.getMovieEditionContext(actor, mediaId, actor.id);
  const option = context.options.find((value) => value.edition === edition);
  if (option === undefined)
    throw new Error("Missing registered movie edition fixture");
  const command = MovieRequestV4Schema.parse({
    schemaVersion: 4,
    mediaId,
    subjectUserId: actor.id,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: option.targetVersion,
      definition: option.storedDefinition,
      request:
        option.request === null
          ? null
          : {
              id: option.request.id,
              version: option.request.version,
              choiceRevision: option.request.choiceRevision,
            },
    },
    selection: {
      edition,
      definitionVersion: option.definitionVersion,
      definitionDigest: option.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages },
  });
  const result = await commands.requestMovieEditionV4(
    actor,
    crypto.randomUUID(),
    command,
  );
  if (result.operationId === null)
    throw new Error("V4 movie fixture omitted its outbox operation");
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: result.operationId },
  });
  const input = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
  return { commands, result, input };
}
