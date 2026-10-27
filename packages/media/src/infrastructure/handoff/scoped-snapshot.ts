import { Prisma } from "#generated/prisma/client.ts";
import type { HandoffProtocolScope } from "#shared/handoff-v2.ts";
import { lockDefaultMedia } from "./default-edition.ts";
import {
  matchesMovieDefinition,
  movieDefinitionRef,
} from "#infrastructure/movie-editions/definition.ts";

export async function lockHandoffScopes(
  tx: Prisma.TransactionClient,
  scope: HandoffProtocolScope,
): Promise<void> {
  await lockDefaultMedia(
    tx,
    scope.media.map((item) => item.mediaId),
  );
  if (!("schemaVersion" in scope)) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId", edition FROM "MediaIntent" WHERE "mediaId" IN (${Prisma.join(scope.media.map((item) => item.mediaId))}) ORDER BY "mediaId", edition FOR UPDATE`,
  );
}

export async function assertLibraryHandoffSnapshot(
  tx: Prisma.TransactionClient,
  scope: HandoffProtocolScope,
): Promise<void> {
  if (!("schemaVersion" in scope)) return;
  for (const target of scope.targets) {
    const current = await tx.mediaIntent.findUnique({
      where: {
        mediaId_edition: { mediaId: target.mediaId, edition: target.edition },
      },
    });
    if (
      (current?.generation ?? null) !== target.generation ||
      (current?.version ?? null) !== target.version
    )
      throw new Error("Initial library adoption target changed");
  }
  for (const file of scope.files) {
    if (
      file.existingAssetId !== null ||
      (await tx.libraryAsset.findUnique({
        where: { path: file.canonicalPath },
      })) !== null
    )
      throw new Error(
        "Initial library adoption cannot reassign a managed file",
      );
    if (file.classification === null) continue;
    const expected = movieDefinitionRef(file.mediaIds[0] ?? "", file.edition);
    const stored = await tx.mediaEditionDefinition.findUnique({
      where: {
        rootMediaId_key: {
          rootMediaId: expected.definition.rootMediaId,
          key: file.edition,
        },
      },
    });
    if (
      expected.definitionDigest !==
        file.classification.definition.definitionDigest ||
      (stored !== null && !matchesMovieDefinition(stored, expected.definition))
    )
      throw new Error("Initial library adoption definition changed");
  }
}
