import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MigrationRecordSchema, SourceKindSchema } from "#shared/migration.ts";
import { catalogIdentity } from "#migration/catalog-targets.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";
import { claimConflict } from "./bindings.ts";
type Item = Prisma.MediaItemGetPayload<{
  include: { parent: { include: { parent: true } } };
}>;
export function relevantRecordWhere(
  media: Item[],
): Prisma.MigrationRecordWhereInput {
  const roots = [
    ...new Map(
      media
        .flatMap((item) => [item, item.parent, item.parent?.parent])
        .filter((item) => item !== null && item !== undefined)
        .filter((item) => item.kind === "movie" || item.kind === "series")
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const matches: Prisma.MigrationRecordWhereInput[] = roots.flatMap((root) =>
    Object.entries(catalogIdentity(root)).map(([key, value]) => ({
      AND: [
        { payload: { path: ["externalIds", key], equals: value } },
        {
          payload: {
            path: ["scope"],
            ...(root.kind === "movie" ? { equals: "movie" } : { not: "movie" }),
          },
        },
      ],
    })),
  );
  return {
    kind: "request",
    OR: [...matches, { payload: { path: ["externalIds"], equals: {} } }],
  };
}
export function parseStoredClaim(
  stored: Prisma.MigrationRecordGetPayload<{ include: { capture: true } }>,
) {
  const record = MigrationRecordSchema.parse(stored.payload);
  if (
    snapshotHash(z.json().parse(record)) !== stored.observationHash ||
    recordKey(
      {
        sourceKind: SourceKindSchema.parse(stored.capture.sourceKind),
        sourceInstanceId: stored.capture.sourceInstanceId,
      },
      record,
    ) !== stored.provenanceKey
  )
    throw claimConflict("Stored claim evidence changed");
  return record;
}
