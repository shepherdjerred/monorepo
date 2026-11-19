import { z } from "zod";
import {
  MovieEditionContextV4Schema,
  type MovieEditionContextV4,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import {
  MovieRequestV4Schema,
  MovieRequestResultV4Schema,
  type MovieRequestV4,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { LanguageSchema } from "#shared/contract.ts";
import { readApi, writeApi } from "#client/api.ts";

export function readMovieContextV4(mediaId: string, subjectUserId: string) {
  return readApi(
    `/media/${encodeURIComponent(mediaId)}/movie-edition-context?subjectUserId=${encodeURIComponent(subjectUserId)}`,
    MovieEditionContextV4Schema.refine(
      (context) =>
        context.mediaId === mediaId && context.subjectUserId === subjectUserId,
      "Movie choices belong to another title or requester",
    ),
    4,
  );
}

/** A fresh v4 command retains only the explicitly reviewed selection and its exact CAS. */
export function movieRequestV4(
  context: MovieEditionContextV4,
  edition: MovieEditionKey,
  languages: string,
  keepingPolicy?: "keep" | "temporary",
): MovieRequestV4 {
  const selected = context.options.find((option) => option.edition === edition);
  if (selected === undefined)
    throw new Error("Choose an edition from the current options.");
  const subtitleLanguages = z
    .array(LanguageSchema)
    .max(20)
    .parse(
      languages
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );
  return MovieRequestV4Schema.parse({
    schemaVersion: 4,
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
    options: {
      subtitleLanguages,
      ...(keepingPolicy === undefined ? {} : { keepingPolicy }),
    },
  });
}

export function submitMovieRequestV4(actorId: string, input: MovieRequestV4) {
  return writeApi({
    actorId,
    path: `/media/${encodeURIComponent(input.mediaId)}/movie-requests`,
    version: 4,
    body: input,
    schema: MovieRequestResultV4Schema.refine(
      (result) =>
        result.mediaId === input.mediaId &&
        result.subjectUserId === input.subjectUserId &&
        result.edition === input.selection.edition,
      "Movie request response belongs to another selection",
    ),
  });
}
