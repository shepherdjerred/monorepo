import type { MediaEditionDefinition } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  movieEditionDefinition,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

export function movieDefinitionRef(
  rootMediaId: string,
  edition: MovieEditionKey,
) {
  const definition = movieEditionDefinition(rootMediaId, edition);
  return {
    definition,
    definitionVersion: definition.definitionVersion,
    definitionDigest: identityHash(definition),
  };
}

export function matchesMovieDefinition(
  row: MediaEditionDefinition,
  expected: ReturnType<typeof movieEditionDefinition>,
): boolean {
  return (
    row.rootMediaId === expected.rootMediaId &&
    row.key === expected.key &&
    row.policy === expected.policy &&
    row.pathLabel === expected.pathLabel &&
    row.plexLabel === expected.plexLabel &&
    row.definitionVersion === expected.definitionVersion
  );
}
