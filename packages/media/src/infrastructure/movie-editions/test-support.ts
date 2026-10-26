import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "./access.ts";
import { z } from "zod";
import { MovieRequestV3Schema } from "#shared/movie-editions/commands.ts";

/** Explicit new consent at a fixture boundary; never called implicitly by acquisition or recovery. */
export async function chooseCurrentTestMovieEdition(
  db: Database,
  input: { requestId: string; access: MovieChoiceAccess },
) {
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: input.requestId },
    include: { user: true },
  });
  if (request.edition !== "default")
    throw new Error("Current default movie fixture request required");
  return chooseTestMovieEdition(db, {
    actor: {
      ...request.user,
      role: z.enum(["owner", "member"]).parse(request.user.role),
    },
    mediaId: request.mediaId,
    access: input.access,
    subtitleLanguages: request.subtitleLanguages,
  });
}

/** Real reviewed command; callers establish their ordinary fixture identities/lease first. */
export async function chooseTestMovieEdition(
  db: Database,
  input: {
    actor: MediaActor;
    mediaId: string;
    subjectUserId?: string;
    edition?: MovieEditionKey;
    access: MovieChoiceAccess;
    subtitleLanguages?: string[];
  },
) {
  const app = new PrismaMediaApplication(db, { keepDays: 7, ...input.access });
  const subjectUserId = input.subjectUserId ?? input.actor.id;
  const context = await app.getMovieEditionContext(
    input.actor,
    input.mediaId,
    subjectUserId,
  );
  const selected = context.options.find(
    (option) => option.edition === (input.edition ?? "default"),
  );
  if (selected === undefined) throw new Error("Fixture edition option absent");
  const key = crypto.randomUUID();
  const command = MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: input.mediaId,
    subjectUserId,
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
      edition: selected.edition,
      definitionVersion: selected.definitionVersion,
      definitionDigest: selected.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages: input.subtitleLanguages ?? [] },
  });
  const result = await app.requestMovieEdition(input.actor, key, command);
  return { app, context, result, key, command };
}
