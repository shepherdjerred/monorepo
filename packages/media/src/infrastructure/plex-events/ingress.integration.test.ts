import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { plexBindingFixture } from "#automation/plex-binding/test-fixture.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import {
  ObservePlexHintInputSchema,
  type PlexWatchHint,
} from "#shared/plex-events/contract.ts";
import { PrismaPlexEventIngress } from "./ingress.ts";
import { createOutboxActivities } from "#automation/store.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
let rating = 200;
async function fixture(target = true) {
  const db = harness.database();
  const produced = target
    ? await plexBindingFixture(db, harness.context(), {
        publicationPending: true,
      })
    : null;
  if (produced !== null) {
    directories.push(produced.files.directory);
    const result = await createPublicationActivities(
      produced.context,
    ).publishMediaToPlex(produced.published.input);
    if (result.status !== "available")
      throw new Error("Actual ingress fixture failed publication");
  }
  const hint: PlexWatchHint = {
    schemaVersion: 1,
    event: "media.scrobble",
    serverMachineId: "fixture-server",
    sectionId: "1",
    ratingKey: produced?.item.ratingKey ?? String(++rating),
    mediaKind: "movie",
  };
  const media =
    produced?.files.media ??
    (await db.mediaItem.create({
      data: {
        kind: "movie",
        title: "Private title",
        externalIds: {
          plexRatingKey: hint.ratingKey,
          plexSectionId: hint.sectionId,
        },
      },
    }));
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 0 },
  });
  if (target)
    await db.mediaIntent.update({
      where: { mediaId_edition: defaultScope(media.id) },
      data: { automationEpoch: 0, generation: 7 },
    });
  const service = new PrismaPlexEventIngress(db, {
    serverMachineId: "fixture-server",
    permittedSections: async () => ({ movie: "1", series: "2" }),
  });
  return { db, media, hint, service, asset: produced?.asset ?? null };
}

test("concurrent duplicate delivery and lost ACK queue one exact private-free operation", async () => {
  const f = await fixture();
  await Promise.all([f.service.accept(f.hint), f.service.accept(f.hint)]);
  await f.service.accept({ ...f.hint, event: "media.stop" });
  const rows = await f.db.operation.findMany({
    where: { targetId: f.media.id, kind: "observe_plex_hint" },
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
  expect(JSON.stringify(rows)).not.toContain(f.media.title);
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

test("server, section, unknown identities and catalog-only targets admit no work", async () => {
  const f = await fixture();
  for (const change of [
    { serverMachineId: "other" },
    { sectionId: "2" },
    { ratingKey: "999999" },
  ])
    await f.service.accept({ ...f.hint, ...change });
  expect(
    await f.db.operation.count({
      where: { targetId: f.media.id, kind: "observe_plex_hint" },
    }),
  ).toBe(0);
  const catalog = await fixture(false);
  await catalog.service.accept(catalog.hint);
  expect(
    await catalog.db.mediaIntent.count({
      where: { mediaId: catalog.media.id },
    }),
  ).toBe(0);
  expect(
    await catalog.db.operation.count({
      where: { targetId: catalog.media.id, kind: "observe_plex_hint" },
    }),
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
  expect(
    await f.db.operation.count({
      where: { targetId: f.media.id, kind: "observe_plex_hint" },
    }),
  ).toBe(1);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  await f.service.accept(f.hint);
  const rows = await f.db.operation.findMany({
    where: { targetId: f.media.id, kind: "observe_plex_hint" },
  });
  expect(rows).toHaveLength(1);
  expect(ObservePlexHintInputSchema.parse(rows[0]?.payload).recoveryEpoch).toBe(
    0,
  );
});

test("duplicate legacy display identity cannot replace or invalidate a current owned Plex claim", async () => {
  const f = await fixture();
  await f.db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Unbound duplicate",
      externalIds: {
        plexSectionId: f.hint.sectionId,
        plexRatingKey: f.hint.ratingKey,
      },
    },
  });
  await f.service.accept(f.hint);
  expect(
    await f.db.operation.count({
      where: { kind: "observe_plex_hint", targetId: f.media.id },
    }),
  ).toBe(1);
  expect(await f.db.watchState.count({ where: { mediaId: f.media.id } })).toBe(
    0,
  );
});

test("an old claim without current physical ownership cannot queue observation through a legacy display fallback", async () => {
  const f = await fixture();
  if (f.asset === null) throw new Error("Actual ingress binding asset missing");
  await f.db.libraryAsset.update({
    where: { id: f.asset.id },
    data: { owned: false },
  });
  await f.service.accept(f.hint);
  expect(
    await f.db.operation.count({
      where: { kind: "observe_plex_hint", targetId: f.media.id },
    }),
  ).toBe(0);
  expect(
    await f.db.watchObservationFence.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
});
