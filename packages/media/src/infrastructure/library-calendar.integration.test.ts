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

const harness = automationTestHarness();
const settings = {
  serverMachineId: "fixture-server",
  sections: { movie: "1", series: "2" },
};

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
  const library = new PrismaLibraryApplication(db, settings);
  const calendar = new PrismaCalendarApplication(db, settings);
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
  await db.mediaRequest.update({
    where: {
      userId_mediaId_edition: {
        userId: actor.id,
        mediaId: fixture.media.id,
        edition: "default",
      },
    },
    data: { active: false, interestState: "finished" },
  });
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
