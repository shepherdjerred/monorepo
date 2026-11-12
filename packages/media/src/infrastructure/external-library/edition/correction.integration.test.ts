import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { externalLibraryFixture } from "#testing/external-library-fixture.ts";
import { PlexClient, type PlexEditionItem } from "#integrations/plex.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { createExternalEditionCorrection } from "./correction.ts";
import { PrismaExternalEditionStore } from "./records.ts";
import {
  ExternalEditionIntentSchema,
  ExternalEditionResultSchema,
} from "./contract.ts";

const h = automationTestHarness();

test("real metadata intent survives lost PUT/readback, cold resumes once, and refuses revoked owners or owned files", async () => {
  const db = h.database();
  const f = await externalLibraryFixture(db);
  const original = f.plexItems.get(f.input.ratingKey);
  if (original === undefined)
    throw new Error("External Plex fixture lost its movie");
  let item: PlexEditionItem = {
    ...original,
    type: "movie",
    editionTitle: "Incorrect Cut",
    viewCount: 4,
    lastViewedAt: 1_234_567,
    viewOffset: 123_456,
  };
  let puts = 0;
  let failedReadback = false;
  const plex = new PlexClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "external-correction-real-db",
    },
    async (url, init) => {
      if (url.pathname === "/identity")
        return Response.json({
          MediaContainer: { machineIdentifier: f.access.serverMachineId },
        });
      if (init.method === "PUT") {
        puts++;
        expect(url.searchParams.get("id")).toBe(item.ratingKey);
        expect(url.searchParams.get("editionTitle.value")).toBe("");
        expect(
          await db.applicationEvent.count({
            where: { kind: "external_plex_edition_intent_v1" },
          }),
        ).toBe(1);
        item.editionTitle = "";
        failedReadback = true;
        throw new Error("Synthetic lost PUT reply");
      }
      return failedReadback
        ? new Response(null, { status: 503 })
        : Response.json({ MediaContainer: { size: 1, Metadata: [item] } });
    },
  );
  const cold = () =>
    createExternalEditionCorrection({
      plex,
      store: new PrismaExternalEditionStore(db),
      expectedServerMachineId: f.access.serverMachineId,
      permittedMovieSection: () => Promise.resolve("1"),
    });
  const part = item.Media?.[0]?.Part[0];
  if (part?.size === undefined)
    throw new Error("External Plex fixture lost its Part");
  const target = {
    mediaId: f.media.id,
    ratingKey: item.ratingKey,
    canonicalPath: part.file,
    sizeBytes: String(part.size),
    edition: "default" as const,
  };
  const authoritySnapshot = async () => ({
    runtime: await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
    leases: await db.legacyWriterLease.findMany(),
    storage: await db.mediaStorageAuthority.findMany(),
    assets: await db.libraryAsset.count(),
    requests: await db.mediaRequest.count(),
    torrents: await db.torrent.count(),
  });
  const before = await authoritySnapshot();
  const review = await cold().preview(f.owner, target);
  const input = { operationId: crypto.randomUUID(), review };
  await expect(cold().apply(f.owner, input)).rejects.toMatchObject({
    service: "plex",
    kind: "unavailable",
  });
  expect(puts).toBe(1);
  const durable = await db.applicationEvent.findFirstOrThrow({
    where: { kind: "external_plex_edition_intent_v1", mediaId: f.media.id },
  });
  expect(ExternalEditionIntentSchema.parse(durable.payload)).toEqual({
    kind: "external_plex_edition_intent_v1",
    ...input,
  });
  expect(
    await db.applicationEvent.count({
      where: { kind: "external_plex_edition_completion_v1" },
    }),
  ).toBe(0);
  failedReadback = false;
  const completion = await cold().apply(f.owner, input);
  expect(completion).toMatchObject({
    status: "completed",
    response: "lost_or_unobserved",
    before: review.before,
    after: {
      editionTitle: "",
      identity: review.before.identity,
      watch: review.before.watch,
    },
  });
  expect(puts).toBe(1);
  const recorded = await db.applicationEvent.findFirstOrThrow({
    where: { kind: "external_plex_edition_completion_v1", mediaId: f.media.id },
  });
  expect(ExternalEditionResultSchema.parse(recorded.payload)).toEqual(
    completion,
  );
  expect(await cold().apply(f.owner, input)).toEqual(completion);
  expect(puts).toBe(1);
  expect(
    await db.applicationEvent.count({
      where: { kind: "external_plex_edition_intent_v1", mediaId: f.media.id },
    }),
  ).toBe(1);
  expect(
    await db.applicationEvent.count({
      where: {
        kind: "external_plex_edition_completion_v1",
        mediaId: f.media.id,
      },
    }),
  ).toBe(1);
  expect(await authoritySnapshot()).toEqual(before);
  await db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member", version: { increment: 1 } },
  });
  await expect(cold().apply(f.owner, input)).rejects.toMatchObject({
    code: "external_edition_changed",
  });
  expect(puts).toBe(1);

  const other = await externalLibraryFixture(db);
  const otherItem = other.plexItems.get(other.input.ratingKey);
  if (otherItem === undefined)
    throw new Error("External Plex fixture lost its second movie");
  item = {
    ...otherItem,
    type: "movie",
    ratingKey: "101",
    editionTitle: "Incorrect Cut",
  };
  const otherPart = item.Media?.[0]?.Part[0];
  if (otherPart?.size === undefined)
    throw new Error("External Plex fixture lost its second Part");
  const otherReview = await cold().preview(other.owner, {
    mediaId: other.media.id,
    ratingKey: item.ratingKey,
    canonicalPath: otherPart.file,
    sizeBytes: String(otherPart.size),
    edition: "default",
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(other.media.id)], {
      createMissing: true,
    }),
  );
  const owned = await db.libraryAsset.create({
    data: {
      path: otherPart.file,
      sizeBytes: BigInt(otherPart.size),
      state: "published",
      owned: true,
      ownershipEpoch: 0,
      checksum: "a".repeat(64),
      editionRootId: other.root.id,
      properties: {},
      coverage: {
        create: { mediaId: other.media.id, current: true },
      },
    },
  });
  await expect(
    cold().apply(other.owner, {
      operationId: crypto.randomUUID(),
      review: otherReview,
    }),
  ).rejects.toMatchObject({ code: "external_edition_changed" });
  expect(puts).toBe(1);
  expect(
    await db.applicationEvent.count({
      where: {
        kind: "external_plex_edition_intent_v1",
        mediaId: other.media.id,
      },
    }),
  ).toBe(0);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: owned.id } }),
  ).toEqual(owned);
});
