import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { externalLibraryFixture } from "#testing/external-library-fixture.ts";
import { PrismaCalendarApplication } from "#infrastructure/library/views/calendar.ts";
import { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import { PrismaRemovalHistoryApplication } from "#infrastructure/library/views/removals.ts";
import {
  CalendarQuerySchema,
  RemovalHistoryQuerySchema,
} from "#shared/household/calendar.ts";
import { LibraryQuerySchema } from "#shared/household/library.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

const harness = automationTestHarness();
const settings = {
  serverMachineId: "fixture-server",
  sections: { movie: "1", series: "2" },
};

test("subtitle authority guards preserve unrelated application-event writes and protect download history", async () => {
  const db = harness.database();
  const eventId = crypto.randomUUID();
  expect(
    await db.$executeRaw`INSERT INTO "ApplicationEvent" (id,kind,payload) VALUES (${eventId},'calendar_guard_control','{}'::jsonb)`,
  ).toBe(1);
  expect(
    await db.applicationEvent.update({
      where: { id: eventId },
      data: { payload: { observed: true } },
    }),
  ).toMatchObject({ id: eventId, payload: { observed: true } });
  await db.applicationEvent.delete({ where: { id: eventId } });
  expect(
    await db.applicationEvent.findUnique({ where: { id: eventId } }),
  ).toBeNull();

  const download = await db.applicationEvent.create({
    data: {
      kind: "subtitle_download_requested",
      payload: { candidateId: "guard-control" },
    },
  });
  await expect(
    db.$executeRaw`UPDATE "ApplicationEvent" SET payload='{}'::jsonb WHERE id=${download.id}`,
  ).rejects.toThrow("Automatic subtitle authority events are immutable");
  await expect(
    db.$executeRaw`DELETE FROM "ApplicationEvent" WHERE id=${download.id}`,
  ).rejects.toThrow("Automatic subtitle authority events are immutable");
  expect(
    await db.applicationEvent.findUnique({ where: { id: download.id } }),
  ).toMatchObject({
    kind: "subtitle_download_requested",
    payload: { candidateId: "guard-control" },
  });
});

test("library and calendar show proved external presence without taking ownership, and enforce fresh access", async () => {
  const db = harness.database();
  const fixture = await externalLibraryFixture(db);
  await fixture.register();
  await db.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: fixture.media.id, edition: "default" },
    },
    data: { libraryKeep: true },
  });
  await db.mediaReleaseDate.create({
    data: {
      id: crypto.randomUUID(),
      mediaId: fixture.media.id,
      region: "US",
      kind: "digital",
      date: "2026-11-13",
      precision: "day",
      observedAt: new Date(),
    },
  });
  const observedSettings = {
    ...settings,
    serverMachineId: fixture.access.serverMachineId,
  };
  const library = new PrismaLibraryApplication(db, observedSettings);
  const calendar = new PrismaCalendarApplication(db, observedSettings);
  const before = await db.libraryAsset.findMany({ orderBy: { id: "asc" } });
  const libraryPage = await library.list(
    fixture.owner,
    LibraryQuerySchema.parse({}),
  );
  const calendarPage = await calendar.list(
    fixture.owner,
    CalendarQuerySchema.parse({
      from: "2026-11-01",
      to: "2026-11-30",
      status: "available",
    }),
  );
  expect(
    libraryPage.items.find((row) => row.id === fixture.media.id),
  ).toMatchObject({ availability: "available", policy: "keep" });
  expect(
    calendarPage.events.find((row) => row.mediaId === fixture.media.id),
  ).toMatchObject({ availability: "available", date: "2026-11-13" });
  expect(await db.libraryAsset.findMany({ orderBy: { id: "asc" } })).toEqual(
    before,
  );
  await db.plexIdentityMapping.update({
    where: { userId: fixture.owner.id },
    data: { verifiedAt: new Date(Date.now() - 301_000) },
  });
  await expect(
    library.list(fixture.owner, LibraryQuerySchema.parse({})),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  await expect(
    calendar.list(
      fixture.owner,
      CalendarQuerySchema.parse({ from: "2026-11-01", to: "2026-11-30" }),
    ),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
});

test("former requesters retain their own completed removal history without household watch details or external disappearance claims", async () => {
  const db = harness.database();
  const fixture = await harness.fixture("history", {
    chooseMovieEdition: false,
  });
  const actor = { ...fixture.user, role: "member" as const };
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: actor.id,
        mediaId: fixture.media.id,
        edition: "default",
      },
    },
  });
  await new PrismaMediaApplication(db, { keepDays: 30 }).cancelRequest(
    actor,
    crypto.randomUUID(),
    request.id,
    request.version,
  );
  const quarantineTime = new Date("2026-11-01T00:00:00Z");
  const decision = await db.retentionDecision.create({
    data: {
      mediaId: fixture.media.id,
      generation: 1,
      state: "purged",
      evidence: {
        recoveryEpoch: 0,
        removalReason: "temporary_interest_released",
        secretHouseholdWatch: "PRIVATE",
      },
      quarantinedAt: quarantineTime,
      purgeAfter: new Date("2026-11-08T00:00:00Z"),
      manifest: { assets: [] },
    },
  });
  await db.applicationEvent.create({
    data: {
      mediaId: fixture.media.id,
      kind: "files_purged",
      payload: { decisionId: decision.id },
      createdAt: new Date("2026-11-08T01:00:00Z"),
    },
  });
  await db.retentionDecision.create({
    data: {
      mediaId: fixture.media.id,
      generation: 1,
      state: "purged",
      evidence: { recoveryEpoch: 0 },
      manifest: { assets: [] },
    },
  });
  const history = new PrismaRemovalHistoryApplication(db, settings);
  const result = await history.list(actor, RemovalHistoryQuerySchema.parse({}));
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    id: decision.id,
    requesterContext: "your_request",
    restoreState: "reacquire",
    reason: "temporary_interest_released",
    purgedAt: "2026-11-08T01:00:00.000Z",
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  const unrelated = await db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Unrelated" },
  });
  await db.plexIdentityMapping.create({
    data: {
      userId: unrelated.id,
      serverMachineId: "fixture-server",
      serverAccountId: unrelated.plexAccountId,
      kind: "account",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      verifiedAt: new Date(),
    },
  });
  const unrelatedHistory = await history.list(
    { ...unrelated, role: "member" },
    RemovalHistoryQuerySchema.parse({}),
  );
  expect(unrelatedHistory.items).toEqual([]);
});

test("calendar episodes retain their followed series identity with or without an intermediate season", async () => {
  const db = harness.database();
  const f = await harness.fixture("calendar", {
    chooseMovieEdition: false,
    kind: "episode",
  });
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Followed series" },
  });
  const season = await db.mediaItem.create({
    data: {
      kind: "season",
      title: "Season 1",
      parentId: series.id,
      seasonNumber: 1,
    },
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { parentId: series.id, seasonNumber: 1, episodeNumber: 1 },
  });
  const nested = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Nested episode",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [{ mediaId: series.id, edition: "default" }], {
      createMissing: true,
    }),
  );
  await db.mediaRequest.create({
    data: { mediaId: series.id, userId: f.user.id },
  });
  for (const mediaId of [f.media.id, nested.id])
    await db.mediaReleaseDate.create({
      data: {
        id: `episode:${mediaId}`,
        mediaId,
        region: "",
        kind: "episode",
        date: "2026-11-15",
        precision: "day",
        observedAt: new Date(),
      },
    });
  const page = await new PrismaCalendarApplication(db, settings).list(
    { ...f.user, role: "member" },
    CalendarQuerySchema.parse({ from: "2026-11-01", to: "2026-11-30" }),
  );
  for (const mediaId of [f.media.id, nested.id])
    expect(
      page.events.find((event) => event.mediaId === mediaId),
    ).toMatchObject({ rootMediaId: series.id, seriesTitle: series.title });
});
