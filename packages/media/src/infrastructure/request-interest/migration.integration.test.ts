import { expect, test } from "vitest";
import { readdir } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createDatabase } from "#infrastructure/database.ts";

test("household migration keeps existing library without manufacturing permanent requester interests", async () => {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017002300_plex_association_binding",
  });
  const db = cluster.database;
  let current: ReturnType<typeof createDatabase> | undefined;
  try {
    // Initialize the strict historical client at its actual pre-monitoring
    // boundary, then advance SQL to the exact pre-household schema. The old
    // client never reads or writes later implicit defaults.
    const migrations = await readdir(
      `${import.meta.dir}/../../../prisma/migrations`,
    );
    for (const name of migrations
      .filter(
        (candidate) =>
          candidate > "20261017002300_plex_association_binding" &&
          candidate <= "20261017005900_movie_inventory_parent",
      )
      .sort())
      cluster.applyMigration(name);
    // The pre-household client deliberately has none of the new implicit fields.
    const owner = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Owner",
        role: "owner",
      },
    });
    const series = await db.mediaItem.create({
      data: { kind: "series", title: "Existing favourite" },
    });
    const episode = await db.mediaItem.create({
      data: {
        kind: "episode",
        title: "Existing episode",
        parentId: series.id,
        airDate: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    await db.mediaIntent.createMany({
      data: [{ mediaId: series.id }, { mediaId: episode.id }],
    });
    await db.mediaRequest.create({
      data: { userId: owner.id, mediaId: series.id },
    });
    await db.retentionHold.create({
      data: { userId: owner.id, mediaId: series.id, isPin: true },
    });
    cluster.applyMigration("20261114000100_household_library");
    current = createDatabase(cluster.url);
    const targets = await current.mediaIntent.findMany({
      where: { mediaId: { in: [series.id, episode.id] } },
    });
    expect(targets).toHaveLength(2);
    expect(
      targets.every(
        (target) => target.libraryKeep && !target.libraryPolicyExplicit,
      ),
    ).toBe(true);
    expect(
      await current.mediaRequest.findFirstOrThrow({
        where: { mediaId: series.id },
      }),
    ).toMatchObject({ keepingPolicy: "temporary", interestState: "following" });
    expect(
      await current.retentionHold.findFirstOrThrow({
        where: { mediaId: series.id },
      }),
    ).toMatchObject({ isPin: true, until: null });
    expect(
      await current.mediaReleaseDate.findUniqueOrThrow({
        where: { id: `episode:${episode.id}` },
      }),
    ).toMatchObject({ kind: "episode", date: "2026-01-02", precision: "day" });
    const fresh = await current.mediaItem.create({
      data: { kind: "movie", title: "New temporary movie" },
    });
    expect(
      await current.mediaIntent.create({ data: { mediaId: fresh.id } }),
    ).toMatchObject({ libraryKeep: false, libraryPolicyExplicit: false });
    expect(
      await current.mediaRequest.create({
        data: { mediaId: fresh.id, userId: owner.id },
      }),
    ).toMatchObject({ keepingPolicy: "temporary", interestState: "following" });
  } finally {
    if (current !== undefined) await current.$disconnect();
    await cluster.close();
  }
}, 60_000);
