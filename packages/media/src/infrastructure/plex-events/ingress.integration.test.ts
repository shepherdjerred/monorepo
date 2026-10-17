import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import {
  ObservePlexHintInputSchema,
  type PlexWatchHint,
} from "#shared/plex-events/contract.ts";
import { PrismaPlexEventIngress } from "./ingress.ts";
import { createOutboxActivities } from "#automation/store.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
let rating = 200;
async function fixture(target = true) {
  const db = cluster.database;
  const hint: PlexWatchHint = {
    schemaVersion: 1,
    event: "media.scrobble",
    serverMachineId: "fixture-server",
    sectionId: "1",
    ratingKey: String(++rating),
    mediaKind: "movie",
  };
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Private title",
      externalIds: {
        plexRatingKey: hint.ratingKey,
        plexSectionId: hint.sectionId,
      },
    },
  });
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 0 },
  });
  if (target)
    await db.$transaction(async (tx) => {
      await lockDefaultScopes(tx, [defaultScope(media.id)], {
        createMissing: true,
      });
      await tx.mediaIntent.update({
        where: { mediaId_edition: defaultScope(media.id) },
        data: { automationEpoch: 0, generation: 7 },
      });
    });
  const service = new PrismaPlexEventIngress(db, {
    serverMachineId: "fixture-server",
    permittedSections: async () => ({ movie: "1", series: "2" }),
  });
  return { db, media, hint, service };
}

test("concurrent duplicate delivery and lost ACK queue one exact private-free operation", async () => {
  const f = await fixture();
  await Promise.all([f.service.accept(f.hint), f.service.accept(f.hint)]);
  await f.service.accept({ ...f.hint, event: "media.stop" });
  const rows = await f.db.operation.findMany({
    where: { targetId: f.media.id },
    include: { outbox: true },
  });
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) throw new Error("Missing hint operation");
  const expected = ObservePlexHintInputSchema.parse(row.payload);
  expect(expected).toEqual({
    schemaVersion: 1,
    operationId: row.id,
    kind: "observe_plex_hint",
    recoveryEpoch: 0,
    mediaId: f.media.id,
    edition: "default",
    generation: 7,
    serverMachineId: "fixture-server",
    sectionId: "1",
    ratingKey: f.hint.ratingKey,
  });
  expect(row.outbox?.payload).toEqual(expected);
  const dispatched: unknown[] = [];
  await createOutboxActivities(f.db, async (input) => {
    dispatched.push(input);
  }).dispatchMediaOutbox();
  expect(dispatched).toContainEqual({
    workflowType: "observePlexEventHintWorkflow",
    workflowId: `media-operation-${row.id}`,
    input: expected,
  });
  expect(JSON.stringify(rows)).not.toMatch(
    /Private title|scrobble|Account|thumb|capability/u,
  );
  expect(await f.db.watchState.count({ where: { mediaId: f.media.id } })).toBe(
    0,
  );
  expect(
    await f.db.watchObservationFence.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  expect(
    await f.db.retentionDecision.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
});

test("server, section, unknown/ambiguous identities and catalog-only targets admit no work", async () => {
  const f = await fixture();
  for (const change of [
    { serverMachineId: "other" },
    { sectionId: "2" },
    { ratingKey: "999999" },
  ])
    await f.service.accept({ ...f.hint, ...change });
  await f.db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Duplicate",
      externalIds: { plexSectionId: "1", plexRatingKey: f.hint.ratingKey },
    },
  });
  await f.service.accept(f.hint);
  expect(await f.db.operation.count({ where: { targetId: f.media.id } })).toBe(
    0,
  );
  const catalog = await fixture(false);
  await catalog.service.accept(catalog.hint);
  expect(
    await catalog.db.mediaIntent.count({
      where: { mediaId: catalog.media.id },
    }),
  ).toBe(0);
  expect(
    await catalog.db.operation.count({ where: { targetId: catalog.media.id } }),
  ).toBe(0);
});

test("new epochs cannot reinterpret an old target and matching numeric IDs in another section are isolated", async () => {
  const f = await fixture();
  await f.db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Hidden section",
      externalIds: { plexSectionId: "9", plexRatingKey: f.hint.ratingKey },
    },
  });
  await f.service.accept(f.hint);
  expect(await f.db.operation.count({ where: { targetId: f.media.id } })).toBe(
    1,
  );
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  await f.service.accept(f.hint);
  const rows = await f.db.operation.findMany({
    where: { targetId: f.media.id },
  });
  expect(rows).toHaveLength(1);
  expect(ObservePlexHintInputSchema.parse(rows[0]?.payload).recoveryEpoch).toBe(
    0,
  );
});
