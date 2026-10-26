import { isDeepStrictEqual } from "node:util";
import type { Database } from "#infrastructure/database.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";

/** Simulated eight-day publication age at the actual writer's first null-CAS only. */
export async function elapsedPublicationClient(db: Database, assetId: string) {
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
  });
  if (asset.plexPublishedAt !== null)
    throw new Error("Publication timing requires the original null timestamp");
  const timestamp = new Date(Date.now() - 8 * 86_400_000);
  let writes = 0;
  const client = queryFixtureDatabase(db, {
    query: {
      libraryAsset: {
        async updateMany({ args, query }) {
          if (
            args.where?.id !== assetId ||
            args.data.plexPublishedAt === undefined
          )
            return query(args);
          if (
            writes !== 0 ||
            !isDeepStrictEqual(args.where, {
              id: assetId,
              plexPublishedAt: null,
            }) ||
            !(args.data.plexPublishedAt instanceof Date) ||
            Object.keys(args.data).length !== 1
          )
            throw new Error(
              "Publication timing requires the exact first timestamp CAS",
            );
          writes++;
          return query({ ...args, data: { plexPublishedAt: timestamp } });
        },
      },
    },
  });
  return {
    db: client,
    timestamp,
    assertWritten: async () => {
      const current = await db.libraryAsset.findUniqueOrThrow({
        where: { id: assetId },
      });
      if (
        writes !== 1 ||
        current.plexPublishedAt?.getTime() !== timestamp.getTime()
      )
        throw new Error(
          "Actual Network publication did not retain its first publication timestamp",
        );
    },
  };
}
