import type { Prisma } from "#generated/prisma/client.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { FileContext } from "#automation/files/types.ts";

async function includesMovie(
  db: Prisma.TransactionClient,
  mediaIds: readonly string[],
) {
  return (
    (await db.mediaItem.count({
      where: { id: { in: [...mediaIds] }, kind: "movie" },
    })) > 0
  );
}

/** Resolve dynamic configuration before entering authority transactions. TV does not read it. */
export async function networkMovieAccess(
  context: Pick<
    MediaAutomationContext,
    "db" | "serverMachineId" | "permittedSections"
  >,
  mediaIds: readonly string[],
): Promise<MovieChoiceAccess | undefined> {
  if (!(await includesMovie(context.db, mediaIds))) return undefined;
  const sections = await context.permittedSections();
  return requireMovieChoiceAccess({
    serverMachineId: context.serverMachineId,
    movieSectionId: sections.movie,
  });
}

/** Invocation-local value: never mutate the shared worker context. */
export async function fileMovieAccess(
  context: FileContext,
  mediaIds: readonly string[],
): Promise<MovieChoiceAccess | undefined> {
  if (!(await includesMovie(context.db, mediaIds))) return undefined;
  return requireMovieChoiceAccess({
    serverMachineId: context.serverMachineId,
    movieSectionId: await context.permittedMovieSection?.(),
  });
}
