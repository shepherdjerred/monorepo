import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import type { PlexMovieAssociationV2 } from "#shared/plex-binding/contract.ts";

/** Full immutable inverse census, including native partial-ACK locations. These
 * are exact stored aliases from actual publication, never guessed cut paths. */
export function movieRollbackRetryPlaybackPathsV1(
  intent: MovieRollbackIntentV1,
  original: PlexMovieAssociationV2,
) {
  const published = intent.source.reference.intent.entries[0];
  const entry = published.entry;
  if (!intent.successor.path.endsWith(`/${entry.libraryPath}`))
    throw new Error(
      "Automatic rollback retry lost its actual stored library alias",
    );
  const library = intent.successor.path.slice(0, -entry.libraryPath.length);
  const directory = intent.predecessor.path.slice(
    0,
    intent.predecessor.path.lastIndexOf("/") + 1,
  );
  if (
    !directory.endsWith("/rollback/") ||
    intent.predecessor.path !== `${directory}${entry.operationId}`
  )
    throw new Error(
      "Automatic rollback retry lost its exact original rollback path",
    );
  const control = directory.slice(0, -"rollback/".length);
  const predecessor = published.predecessor;
  if (predecessor === null)
    throw new Error("Automatic rollback retry has no actual predecessor");
  const assets = [intent.predecessor, intent.successor, predecessor];
  return [
    ...new Set([
      ...assets.flatMap((asset) => [
        asset.path,
        ...[...asset.subtitles, ...asset.subtitleHistory].flatMap((caption) =>
          caption.path === null ? [] : [caption.path],
        ),
      ]),
      ...published.participants.map(
        (participant) =>
          `${participant.physical.root === "library" ? library : control}${participant.physical.path}`,
      ),
      ...entry.previousSidecars.map(
        (caption) => `${library}${caption.libraryPath}`,
      ),
      `${control}rollback/recover-${intent.successor.id}`,
      `${control}staging/recover-${intent.successor.id}`,
      original.group.canonicalPath,
      ...original.item.media.flatMap((media) =>
        media.parts.map((part) => part.file),
      ),
    ]),
  ].sort();
}
