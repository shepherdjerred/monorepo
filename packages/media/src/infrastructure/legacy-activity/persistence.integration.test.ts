import { afterAll, beforeAll, expect, test } from "vitest";
import { tokenHash } from "#application/security.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import {
  LegacyActivityEventSchema,
  legacyActivityKey,
} from "#shared/legacy-activity/contract.ts";
import { importLegacyActivity, readLegacyActivity } from "./persistence.ts";
import {
  MigrationRecordSchema,
  MigrationSnapshotSchema,
} from "#shared/migration.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;

beforeAll(async () => {
  cluster = await startMediaTestPostgres();
});
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

function makeEvent(instanceId: string, id: number) {
  return LegacyActivityEventSchema.parse({
    source: "bazarr",
    sourceInstanceId: instanceId,
    table: "episode",
    originalId: id,
    sourceDate: "2026-06-29T03:33:53.905381Z",
    action: 1,
    mediaId: 72,
    seriesId: 40,
    provider: "Example Subtitles",
    language: "en:forced",
    score: 100,
    scoreOutOf: 100,
    upgradedFromId: null,
  });
}

async function fixture() {
  const db = cluster.database;
  const owner = await db.mediaUser.create({
    data: {
      role: "owner",
      displayName: "Owner",
      plexAccountId: crypto.randomUUID(),
    },
  });
  const event = makeEvent(crypto.randomUUID(), 1);
  return { db, owner, event };
}

test("an imported event retains its date and original facts without active effects", async () => {
  const { db, owner, event } = await fixture();
  const input = { kind: "legacy_activity", events: [event] } as const;
  const counts = () =>
    Promise.all([
      db.notificationDelivery.count(),
      db.outboxCommand.count(),
      db.operation.count(),
      db.mediaRequest.count(),
      db.libraryAsset.count(),
    ]);
  const before = await counts();
  const results = await Promise.all([
    importLegacyActivity(db, owner, { ...input, events: [event] }),
    importLegacyActivity(db, owner, { ...input, events: [event] }),
  ]);
  expect(results).toContainEqual({ imported: 1, unchanged: 0 });
  expect(results).toContainEqual({ imported: 0, unchanged: 1 });
  expect(
    await db.applicationEvent.findUniqueOrThrow({
      where: { dedupeKey: legacyActivityKey(event) },
    }),
  ).toMatchObject({
    kind: "legacy_activity",
    actorId: null,
    mediaId: null,
    createdAt: new Date("2026-06-29T03:33:53.905Z"),
    payload: event,
  });
  expect(await counts()).toEqual(before);
});

test("a conflicting replay rolls back new events in the same batch", async () => {
  const { db, owner, event } = await fixture();
  const next = makeEvent(event.sourceInstanceId, 2);
  await importLegacyActivity(db, owner, {
    kind: "legacy_activity",
    events: [event],
  });
  await expect(
    importLegacyActivity(db, owner, {
      kind: "legacy_activity",
      events: [next, { ...event, sourceDate: "2026-06-29T04:33:53Z" }],
    }),
  ).rejects.toMatchObject({ status: 409, code: "legacy_activity_conflict" });
  expect(
    await db.applicationEvent.findUnique({
      where: { dedupeKey: legacyActivityKey(next) },
    }),
  ).toBeNull();
});

test("source pages retain same-time identities and require the current owner role", async () => {
  const { db, owner, event } = await fixture();
  const rows = Array.from({ length: 52 }, (_, index) =>
    makeEvent(event.sourceInstanceId, index + 1),
  );
  await importLegacyActivity(db, owner, {
    kind: "legacy_activity",
    events: rows,
  });
  const first = await readLegacyActivity(db, owner, { source: "bazarr" });
  expect(first.items).toHaveLength(50);
  if (first.nextCursor === null)
    throw new Error("Activity continuation was absent");
  const second = await readLegacyActivity(db, owner, {
    source: "bazarr",
    before: first.nextCursor,
  });
  expect(second.nextCursor).toBeNull();
  const all = [...first.items, ...second.items];
  expect(new Set(all.map(({ id }) => id)).size).toBe(all.length);
  expect(
    all.filter((row) => row.event.sourceInstanceId === event.sourceInstanceId),
  ).toHaveLength(52);
  await expect(
    readLegacyActivity(db, owner, { source: "sonarr" }),
  ).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
  await db.mediaUser.update({
    where: { id: owner.id },
    data: { role: "member" },
  });
  await expect(
    readLegacyActivity(db, owner, { source: "bazarr" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    importLegacyActivity(db, owner, {
      kind: "legacy_activity",
      events: [event],
    }),
  ).rejects.toMatchObject({ status: 403 });
});

test("Sonarr links the exact recorded episode and retains unmatched rows", async () => {
  const { db, owner } = await fixture();
  const tmdb = 58_555;
  const tvdb = 9493;
  const root = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Fixture show",
      tmdbId: tmdb,
      externalIds: { tmdb, tvdb },
    },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Fixture episode",
      parentId: root.id,
      seasonNumber: 2,
      episodeNumber: 3,
    },
  });
  const pvcUid = crypto.randomUUID();
  const capture = {
    sourceKind: "sonarr" as const,
    sourceInstanceId: tokenHash(`kubernetes-pvc:media/sonarr-pvc:${pvcUid}`),
  };
  const firstSeries = {
    kind: "media",
    sourceId: "series:11",
    mediaKind: "series",
    externalIds: { tmdb, tvdb },
    parentSourceId: null,
    season: null,
    episode: null,
    profileSourceId: null,
    monitored: false,
  };
  const records = [
    firstSeries,
    {
      ...firstSeries,
      sourceId: "series:12",
      externalIds: { tmdb, tvdb: tvdb + 1 },
    },
    {
      ...firstSeries,
      sourceId: "episode:13",
      mediaKind: "episode",
      externalIds: {},
      parentSourceId: "series:11",
      season: 2,
      episode: 3,
    },
    {
      ...firstSeries,
      sourceId: "episode:14",
      mediaKind: "episode",
      externalIds: {},
      parentSourceId: "series:12",
      season: 2,
      episode: 3,
    },
  ].map((row) => MigrationRecordSchema.parse(row));
  await db.mediaRuntimeState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", mode: "observe" },
    update: {},
  });
  await new PrismaMigrationAdministration(db).upload(owner, {
    snapshot: MigrationSnapshotSchema.parse({
      ...capture,
      schemaVersion: 1,
      sourceVersion: "4.0",
      startedAt: "2026-11-24T00:00:00Z",
      completedAt: "2026-11-24T00:01:00Z",
      endpoints: [
        {
          name: "media",
          pages: 1,
          records: records.length,
          digest: recordDigest(records),
          complete: true,
          stable: true,
          reason: "complete",
        },
        {
          name: "files",
          pages: 1,
          records: 0,
          digest: recordDigest([]),
          complete: true,
          stable: true,
          reason: "complete",
        },
      ],
      records,
    }),
  });
  const event = LegacyActivityEventSchema.parse({
    source: "sonarr",
    sourceInstanceId: pvcUid,
    originalId: 1,
    sourceDate: "2025-06-29T03:33:53.905381Z",
    table: "history",
    action: "downloadFolderImported",
    actionCode: null,
    fileId: null,
    qualityId: null,
    customFormatScore: null,
    provider: null,
    seriesId: 11,
    episodeId: 13,
  });
  const foreignCapture = {
    ...event,
    originalId: 2,
    sourceInstanceId: crypto.randomUUID(),
  };
  const wrongParent = LegacyActivityEventSchema.parse({
    ...event,
    originalId: 3,
    seriesId: 12,
  });
  const wrongCatalog = LegacyActivityEventSchema.parse({
    ...event,
    originalId: 4,
    seriesId: 12,
    episodeId: 14,
  });
  await expect(
    importLegacyActivity(db, owner, {
      kind: "legacy_activity",
      events: [event, foreignCapture, wrongParent, wrongCatalog],
    }),
  ).resolves.toEqual({
    imported: 4,
    unchanged: 0,
  });
  const page = await readLegacyActivity(db, owner, { source: "sonarr" });
  expect(
    page.items
      .map((item) => item.event.originalId)
      .sort((left, right) => left - right),
  ).toEqual([1, 2, 3, 4]);
  expect(
    page.items.flatMap((item) =>
      item.media === undefined ? [] : [item.media],
    ),
  ).toEqual([{ id: episode.id, title: episode.title }]);
  expect(
    await db.applicationEvent.findUniqueOrThrow({
      where: { dedupeKey: legacyActivityKey(event) },
    }),
  ).toMatchObject({ mediaId: episode.id, payload: event });
});
