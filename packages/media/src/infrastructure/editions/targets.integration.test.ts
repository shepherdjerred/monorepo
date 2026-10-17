import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { defaultScope, defaultIntent } from "#shared/editions/scope.ts";
import {
  lockCanonicalMedia,
  lockDefaultScopes,
  lockExistingDefaultTargets,
} from "./locks.ts";
import { mirrorDefaultAvailability } from "./availability.ts";
import { targetWhere } from "./targets.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test("metadata locks do not create targets; new direct-series episodes get the actual root", async () => {
  const db = cluster.database;
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Canonical" },
  });
  const episode = await db.mediaItem.create({
    data: { kind: "episode", title: "Direct child", parentId: series.id },
  });
  await db.$transaction(async (tx) => {
    await lockCanonicalMedia(tx, [episode.id]);
    await lockExistingDefaultTargets(tx, [episode.id]);
  });
  expect(await db.mediaIntent.count({ where: { mediaId: episode.id } })).toBe(
    0,
  );
  const targets = await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(episode.id)], { createMissing: true }),
  );
  expect(targets).toMatchObject([
    {
      existed: false,
      target: {
        lineage: "resolved",
        editionRootId: series.id,
        desiredPresence: false,
        monitoring: false,
        automationEpoch: -1,
      },
    },
  ]);
});

test("existing unresolved lineage stays unresolved and a changed non-null root is rejected", async () => {
  const db = cluster.database;
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Canonical" },
  });
  const episode = await db.mediaItem.create({
    data: { kind: "episode", title: "Historical orphan" },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(episode.id)], { createMissing: true }),
  );
  await db.mediaItem.update({
    where: { id: episode.id },
    data: { parentId: series.id },
  });
  const unresolved = await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(episode.id)], { createMissing: true }),
  );
  expect(unresolved[0]?.target).toMatchObject({
    lineage: "unresolved",
    editionRootId: null,
    automationEpoch: -1,
  });
  const second = await db.mediaItem.create({
    data: { kind: "series", title: "Other root" },
  });
  const bound = await db.mediaItem.create({
    data: { kind: "episode", title: "Bound", parentId: series.id },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(bound.id)], { createMissing: true }),
  );
  await db.mediaItem.update({
    where: { id: bound.id },
    data: { parentId: second.id },
  });
  await expect(
    db.$transaction((tx) =>
      lockDefaultScopes(tx, [defaultScope(bound.id)], { createMissing: false }),
    ),
  ).rejects.toMatchObject({ code: "lineage_unresolved" });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(bound.id)),
    }),
  ).toMatchObject({ editionRootId: series.id, automationEpoch: -1 });
});

test("availability mirror changes only the default state and rolls back the original CAS if a target is absent", async () => {
  const db = cluster.database;
  const media = await db.mediaItem.create({
    data: { kind: "movie", title: "Mirror" },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(media.id)], { createMissing: true }),
  );
  await db.mediaEditionDefinition.create({
    data: {
      rootMediaId: media.id,
      key: "future-inert",
      policy: "unavailable",
      pathLabel: "future",
      plexLabel: "future",
      displayLabel: "Inert test target",
    },
  });
  await db.mediaIntent.create({
    data: {
      mediaId: media.id,
      edition: "future-inert",
      editionRootId: media.id,
      availability: "wanted",
      desiredPresence: false,
      monitoring: false,
      automationEpoch: -1,
    },
  });
  const before = await db.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(media.id)),
  });
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(media.id)], {
      createMissing: false,
    });
    await tx.mediaItem.update({
      where: { id: media.id, version: 0 },
      data: { availability: "downloading", version: { increment: 1 } },
    });
    await mirrorDefaultAvailability(tx, [media.id], "downloading");
  });
  const all = await db.mediaIntent.findMany({ where: { mediaId: media.id } });
  expect(defaultIntent(all)).toMatchObject({
    availability: "downloading",
    version: before.version,
    generation: before.generation,
    automationEpoch: before.automationEpoch,
  });
  expect(all.find((row) => row.edition === "future-inert")?.availability).toBe(
    "wanted",
  );
  const absent = await db.mediaItem.create({
    data: { kind: "movie", title: "No target" },
  });
  await expect(
    db.$transaction(async (tx) => {
      await lockCanonicalMedia(tx, [absent.id]);
      await lockExistingDefaultTargets(tx, [absent.id]);
      await tx.mediaItem.update({
        where: { id: absent.id, version: 0 },
        data: { availability: "downloading", version: { increment: 1 } },
      });
      await mirrorDefaultAvailability(tx, [absent.id], "downloading");
    }),
  ).rejects.toThrow("requires every default");
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: absent.id } }),
  ).toMatchObject({ availability: "wanted", version: 0 });
  expect(await db.mediaIntent.count({ where: { mediaId: absent.id } })).toBe(0);
});
