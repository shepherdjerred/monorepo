import {
  MovieRequestV3Schema,
  type MovieRequestV3,
} from "#shared/movie-editions/commands.ts";
import type { MovieEditionContextV3 } from "#shared/movie-editions/view.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";

/**
 * The version-3 request body the retained v3 route accepts, built from the
 * context that route returned. The household client no longer sends these.
 */
export function movieRequestV3(
  context: MovieEditionContextV3,
  edition: MovieEditionKey,
  subtitleLanguages: string[],
): MovieRequestV3 {
  const selected = context.options.find((option) => option.edition === edition);
  if (selected === undefined)
    throw new Error("Choose an edition from the current options.");
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
