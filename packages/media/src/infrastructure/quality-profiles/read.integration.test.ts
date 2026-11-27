import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { compileQualityGuide } from "#domain/quality-guide/compile.ts";
import guides from "#domain/quality-guide/guide-fixture.json";
import { reconcileRetiredQualityProfiles } from "./reconcile.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let app: PrismaMediaApplication;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  app = new PrismaMediaApplication(cluster.database, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

async function fixture(kind: "movie" | "series" = "movie") {
  const db = cluster.database;
  const user = (role: "owner" | "member") =>
    db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: `Profile ${role}`,
        role,
      },
    });
  const owner = await user("owner");
  const member = await user("member");
  const profile = await db.qualityProfile.create({
    data: {
      name: `Profile ${crypto.randomUUID()}`,
      rules: { qualities: ["WEB-1080p"], preferredGroups: ["private-group"] },
    },
  });
  await db.qualityProfileDefault.upsert({
    where: { kind },
    create: { kind, profileId: profile.id },
    update: { profileId: profile.id },
  });
  return { db, owner, member, profile };
}

test("the profile list reaches only the owner; anyone else reads an empty list", async () => {
  const f = await fixture();
  const profiles = await app.profiles(f.owner);
  expect(profiles.find((row) => row.id === f.profile.id)).toMatchObject({
    name: f.profile.name,
    rules: { preferredGroups: ["private-group"] },
  });
  // The previous client's title page still asks for the list: empty, not refused.
  expect(await app.profiles(f.member)).toEqual([]);
  // The stored role decides, not the role a signed-in session still carries.
  expect(await app.profiles({ ...f.member, role: "owner" })).toEqual([]);
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member" },
  });
  expect(await app.profiles(f.owner)).toEqual([]);
});

test("the profile defaults reach only the owner; anyone else is refused", async () => {
  const f = await fixture();
  const defaults = await app.profileDefaults(f.owner);
  expect(defaults.find((row) => row.kind === "movie")).toMatchObject({
    profileId: f.profile.id,
  });
  await expect(app.profileDefaults(f.member)).rejects.toMatchObject({
    code: "forbidden",
    status: 403,
  });
  await expect(
    app.profileDefaults({ ...f.member, role: "owner" }),
  ).rejects.toMatchObject({ code: "forbidden", status: 403 });
});

test("a session whose account no longer exists reads neither", async () => {
  const f = await fixture();
  const gone = { ...f.owner, plexAccountId: crypto.randomUUID() };
  await expect(app.profiles(gone)).rejects.toMatchObject({
    code: "unauthenticated",
    status: 401,
  });
  await expect(app.profileDefaults(gone)).rejects.toMatchObject({
    code: "unauthenticated",
    status: 401,
  });
});

test("retirement hides a choice and migrates only targets without an active reservation", async () => {
  const f = await fixture("series");
  const { db, owner, profile } = f;
  const { rules } = compileQualityGuide("series", {
    revision: guides.revision,
    committedAt: guides.committedAt,
    ...guides.sources.series,
  });
  const legacy = {
    qualities: ["WEB-1080p"],
    cutoffQuality: "WEB-1080p",
    cutoffScore: 0,
    rejectedCodecs: [],
    requiredAudioLanguages: [],
    minimumBytes: 0,
    maximumBytes: 100_000_000_000,
    minimumScore: 0,
    tagScores: {},
  };
  await db.qualityProfile.update({
    where: { id: profile.id },
    data: { rules: legacy },
  });
  await db.qualityProfileVersion.create({
    data: { profileId: profile.id, version: 0, rules: legacy },
  });
  const replacement = await db.qualityProfile.create({
    data: { name: "TRaSH TV", version: 1, rules },
  });
  const input = {
    expectedVersion: 0,
    replacementId: replacement.id,
    kind: "series" as const,
  };
  await expect(
    app.retireProfile(owner, crypto.randomUUID(), profile.id, input),
  ).rejects.toMatchObject({ code: "profile_is_default" });
  const defaults = await app.profileDefaults(owner);
  await app.setProfileDefault(owner, crypto.randomUUID(), "series", {
    expectedVersion:
      defaults.find((row) => row.kind === "series")?.version ?? 0,
    profileId: replacement.id,
  });

  const series = await db.mediaItem.create({
    data: { title: "Retirement", kind: "series" },
  });
  const [idle, active] = await Promise.all(
    ["Idle", "Reserved"].map(async (title, index) => {
      const item = await db.mediaItem.create({
        data: {
          title,
          kind: "episode",
          parentId: series.id,
          seasonNumber: 1,
          episodeNumber: index + 1,
        },
      });
      return await db.mediaIntent.create({
        data: { mediaId: item.id, profileId: profile.id },
      });
    }),
  );
  if (idle === undefined || active === undefined)
    throw new Error("Expected two titles");
  const release = await db.releaseCandidate.create({
    data: {
      providerId: "knaben",
      providerReleaseId: crypto.randomUUID(),
      title: "Reserved",
      attributes: {},
      evaluation: {},
      mediaIds: [active.mediaId],
    },
  });
  const sponsor = await db.mediaRequest.create({
    data: {
      mediaId: active.mediaId,
      edition: active.edition,
      userId: owner.id,
    },
  });
  const attempt = await db.acquisitionAttempt.create({
    data: {
      operationId: crypto.randomUUID(),
      releaseId: release.id,
      sponsorRequestId: sponsor.id,
      mediaIds: [active.mediaId],
      generations: { [active.mediaId]: active.generation },
      state: "downloading",
      reservations: {
        create: { mediaId: active.mediaId, generation: active.generation },
      },
    },
  });
  const key = crypto.randomUUID();
  const retired = await app.retireProfile(owner, key, profile.id, input);
  expect(await app.retireProfile(owner, key, profile.id, input)).toEqual(
    retired,
  );
  const visibleProfiles = await app.profiles(owner);
  expect(visibleProfiles.some((row) => row.id === profile.id)).toBe(false);
  await reconcileRetiredQualityProfiles(db);
  const targets = () =>
    db.mediaIntent.findMany({
      where: { mediaId: { in: [idle.mediaId, active.mediaId] } },
      select: { mediaId: true, profileId: true, generation: true },
    });
  expect(await targets()).toEqual(
    expect.arrayContaining([
      {
        mediaId: idle.mediaId,
        profileId: replacement.id,
        generation: idle.generation + 1,
      },
      {
        mediaId: active.mediaId,
        profileId: profile.id,
        generation: active.generation,
      },
    ]),
  );
  await db.acquisitionReservation.deleteMany({
    where: { attemptId: attempt.id },
  });
  await reconcileRetiredQualityProfiles(db);
  const migrated = await targets();
  expect(migrated.every((row) => row.profileId === replacement.id)).toBe(true);
  expect(
    await db.qualityProfileVersion.findUnique({
      where: { profileId_version: { profileId: profile.id, version: 0 } },
    }),
  ).not.toBe(null);
});
