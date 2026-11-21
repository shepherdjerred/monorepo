import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";

const AddedSchema = z.array(z.object({ id: z.string(), addedAt: z.date() }));
type Added = z.infer<typeof AddedSchema>[number];

/**
 * When each of the given movies and series was added to the library, newest
 * first, for the titles that have something to play.
 *
 * "Added" is not a stored fact. A title's own row is created when it is first
 * looked up or adopted, long before or after its files arrive, and Plex's own
 * date is not kept. What Media does keep is every file it ever recorded for a
 * movie or episode: publishing an upgrade marks the old coverage row not
 * current and leaves the row in place, and nothing outside tests deletes one.
 * So, for each movie or episode that has a current default-edition file, the
 * earliest file ever recorded for it is when it arrived, and an upgrade does
 * not move that. A title's date is the latest of those: the newest part of it
 * that can be played now. A series therefore moves up when a new episode
 * lands, not when an old one is replaced.
 *
 * A title with no current file has no date and is left out, so a page ordered
 * this way lists only titles with playable content. A file in a registered
 * external library counts from when Media first recorded it.
 */
async function readAdded(
  tx: Prisma.TransactionClient,
  rootIds: readonly string[],
  page: Prisma.Sql,
): Promise<Added[]> {
  const ids = [...new Set(rootIds)];
  if (ids.length === 0) return [];
  return AddedSchema.parse(
    await tx.$queryRaw(Prisma.sql`
      WITH wanted AS (
        SELECT unnest(ARRAY[${Prisma.join(ids)}]::text[]) AS id
      ),
      tree AS (
        SELECT wanted.id AS "rootId", wanted.id AS "mediaId"
        FROM wanted
        UNION ALL
        SELECT child."parentId", child.id
        FROM "MediaItem" child
        JOIN wanted ON wanted.id = child."parentId"
        UNION ALL
        SELECT child."parentId", grandchild.id
        FROM "MediaItem" grandchild
        JOIN "MediaItem" child ON child.id = grandchild."parentId"
        JOIN wanted ON wanted.id = child."parentId"
      )
      SELECT tree."rootId" AS id, max(arrival."addedAt") AS "addedAt"
      FROM tree
      JOIN LATERAL (
        SELECT min(asset."createdAt") AS "addedAt"
        FROM "AssetCoverage" coverage
        JOIN "LibraryAsset" asset ON asset.id = coverage."assetId"
        WHERE coverage."mediaId" = tree."mediaId"
          AND coverage.edition = 'default'
        HAVING bool_or(coverage."current")
      ) arrival ON true
      GROUP BY tree."rootId"
      ${page}
    `),
  );
}

/** When each title was added, for the titles of one page; absent when nothing can be played. */
export async function libraryAddedAt(
  tx: Prisma.TransactionClient,
  rootIds: readonly string[],
): Promise<ReadonlyMap<string, Date>> {
  const rows = await readAdded(tx, rootIds, Prisma.empty);
  return new Map(rows.map((row) => [row.id, row.addedAt]));
}

/**
 * One page of the given titles ordered `(addedAt DESC, id DESC)`, starting
 * after the cursor. The cursor is compared as a UTC instant, like the stored
 * timestamps, whatever the session's time zone.
 */
export function libraryAddedPage(
  tx: Prisma.TransactionClient,
  rootIds: readonly string[],
  page: { after: { addedAt: string; id: string } | null; take: number },
): Promise<Added[]> {
  const after =
    page.after === null
      ? Prisma.empty
      : Prisma.sql`HAVING (max(arrival."addedAt"), tree."rootId") < (${page.after.addedAt}::timestamptz AT TIME ZONE 'UTC', ${page.after.id})`;
  return readAdded(
    tx,
    rootIds,
    Prisma.sql`${after} ORDER BY max(arrival."addedAt") DESC, tree."rootId" DESC LIMIT ${page.take}`,
  );
}
