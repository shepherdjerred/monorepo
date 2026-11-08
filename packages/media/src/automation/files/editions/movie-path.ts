import path from "node:path";
import {
  MovieEditionDefinitionSchema,
  type MovieEditionDefinition,
} from "#shared/movie-editions/registry.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  newLibraryPath,
  type NamingItem,
} from "#automation/files/library-path.ts";

/** Registered cut labels belong in both components so Plex cannot merge edition files. */
export function movieEditionLibraryPath(
  movie: NamingItem,
  sourceFilename: string,
  rawDefinition: MovieEditionDefinition,
): string {
  const definition = MovieEditionDefinitionSchema.parse(rawDefinition);
  if (movie.kind !== "movie" || definition.rootMediaId !== movie.id)
    throw new FileGuardError("edition_definition_conflict");
  const original = newLibraryPath([movie], sourceFilename);
  if (definition.key === "default") return original;
  const label = definition.plexLabel;
  if (
    label.length === 0 ||
    label.length > 32 ||
    ["{", "}", "/", "\\", "\0"].some((value) => label.includes(value))
  )
    throw new FileGuardError("edition_definition_conflict");
  const folder = path.posix.dirname(original);
  const filename = path.posix.basename(original);
  const extension = path.posix.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  const suffix = ` {edition-${label}}`;
  return `${folder}${suffix}/${stem}${suffix}${extension}`;
}
