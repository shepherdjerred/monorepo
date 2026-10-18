import { z } from "zod";
import {
  MovieRequestV3Schema,
  MovieRequestResultV3Schema,
  type MovieRequestV3,
} from "#shared/movie-editions/commands.ts";
import {
  MovieEditionContextV3Schema,
  type MovieEditionContextV3,
} from "#shared/movie-editions/view.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { LanguageSchema } from "#shared/contract.ts";
import { readApi, writeApi, queryClient } from "#client/api.ts";

export async function readMovieContext(mediaId: string, subjectUserId: string) {
  return readApi(
    `/media/${encodeURIComponent(mediaId)}/movie-edition-context?subjectUserId=${encodeURIComponent(subjectUserId)}`,
    MovieEditionContextV3Schema.refine(
      (context) =>
        context.mediaId === mediaId && context.subjectUserId === subjectUserId,
      "Movie choices belong to another title or requester",
    ),
    3,
  );
}

export function movieRequest(
  context: MovieEditionContextV3,
  edition: MovieEditionKey,
  languages: string,
): MovieRequestV3 {
  const selected = context.options.find((option) => option.edition === edition);
  if (selected === undefined)
    throw new Error("Choose an edition from the current options.");
  const subtitleLanguages = z
    .array(LanguageSchema)
    .max(20)
    .parse(
      languages
        .split(",")
        .map((language) => language.trim())
        .filter((language) => language.length > 0),
    );
  return MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: context.mediaId,
    subjectUserId: context.subjectUserId,
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
      edition,
      definitionVersion: selected.definitionVersion,
      definitionDigest: selected.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages },
  });
}

export async function submitMovieRequest(
  actorId: string,
  input: MovieRequestV3,
) {
  return writeApi({
    actorId,
    path: `/media/${encodeURIComponent(input.mediaId)}/movie-requests`,
    version: 3,
    body: input,
    schema: MovieRequestResultV3Schema.refine(
      (result) =>
        result.mediaId === input.mediaId &&
        result.subjectUserId === input.subjectUserId &&
        result.edition === input.selection.edition,
      "Movie request response belongs to another selection",
    ),
  });
}

export async function invalidateMovieRequests(mediaId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["movie-requests"] }),
    queryClient.invalidateQueries({ queryKey: ["movie-edition-context"] }),
    queryClient.invalidateQueries({ queryKey: ["requests"] }),
    queryClient.invalidateQueries({
      queryKey: mediaId === undefined ? ["media"] : ["media", mediaId],
    }),
    queryClient.invalidateQueries({ queryKey: ["target"] }),
  ]);
}
