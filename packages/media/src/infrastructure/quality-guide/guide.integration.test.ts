import { afterAll, beforeAll, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { GuideBundleSchema } from "#domain/quality-guide/contract.ts";
import source from "#domain/quality-guide/guide-fixture.json";
import { qualityGuideActivities } from "#automation/quality-guide/activities.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import type { MediaActor } from "#application/auth.ts";
import type { QualityGuideKind } from "#shared/quality-guide/contract.ts";
import { PrismaQualityGuideAdministration } from "./service.ts";
import { householdCaptionRequirements } from "./captions.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { CredentialCipher } from "#application/security.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import {
  grantTestLease,
  grantTestRequesterAccess,
} from "#testing/authority.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { reserveCandidate } from "#automation/acquisition-reservation.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let owner: MediaActor;
let member: MediaActor;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  owner = await cluster.database.mediaUser.create({
    data: { plexAccountId: "guide-owner", displayName: "Owner", role: "owner" },
  });
  member = await cluster.database.mediaUser.create({
    data: { plexAccountId: "guide-member", displayName: "Member" },
  });
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

function fixture() {
  let changed = false;
  let invalid = false;
  const guide = {
    async load(kind: QualityGuideKind) {
      if (invalid) throw new Error("Synthetic invalid guide response");
      const bundle = GuideBundleSchema.parse({
        revision: changed ? "b".repeat(40) : source.revision,
        committedAt: source.committedAt,
        ...source.sources[kind],
      });
      if (changed) {
        const hdr = bundle.formats.find((format) => format.name === "HDR");
        if (hdr?.trash_scores === undefined)
          throw new Error("HDR fixture has no source scores");
        hdr.trash_scores["default"] = 501;
      }
      return bundle;
    },
  };
  return {
    guide,
    service: new PrismaQualityGuideAdministration(cluster.database, guide),
    changed: () => {
      changed = true;
    },
    invalid: () => {
      invalid = true;
    },
  };
}

async function createProfile(
  f: ReturnType<typeof fixture>,
  kind: QualityGuideKind,
) {
  const preview = await f.service.preview(owner, { kind, scoreOverrides: {} });
  return f.service.apply(owner, crypto.randomUUID(), {
    kind,
    scoreOverrides: {},
    expectedRevision: preview.revision,
    expectedContentHash: preview.contentHash,
    profileId: null,
    expectedVersion: 0,
  });
}

test("owner previews and applies one reviewed immutable version; replay and stale source are fenced", async () => {
  const f = fixture();
  await expect(
    f.service.preview(member, { kind: "movie", scoreOverrides: {} }),
  ).rejects.toMatchObject({ status: 403 });
  const preview = await f.service.preview(owner, {
    kind: "movie",
    scoreOverrides: {},
  });
  const input = {
    kind: "movie" as const,
    scoreOverrides: {},
    expectedRevision: preview.revision,
    expectedContentHash: preview.contentHash,
    profileId: null,
    expectedVersion: 0,
  };
  const result = await f.service.apply(owner, "reviewed-guide", input);
  f.invalid();
  await expect(
    f.service.apply(owner, "reviewed-guide", input),
  ).resolves.toEqual(result);
  expect(
    await cluster.database.qualityProfileVersion.count({
      where: { profileId: result.profileId },
    }),
  ).toBe(1);
  const changed = fixture();
  changed.changed();
  await expect(
    changed.service.apply(owner, "stale-guide-preview", input),
  ).rejects.toMatchObject({ code: "guide_changed" });
  const revoked = await cluster.database.mediaUser.create({
    data: {
      plexAccountId: "guide-revoked",
      displayName: "Former owner",
      role: "member",
    },
  });
  await expect(
    f.service.status({ ...revoked, role: "owner" }),
  ).rejects.toMatchObject({ status: 403 });
});

test("daily selected changes append versions, retain overrides and preserve playable files on invalid updates", async () => {
  const f = fixture();
  const preview = await f.service.preview(owner, {
    kind: "movie",
    scoreOverrides: {},
  });
  const atmos = preview.rules.resolved?.customFormats.find(
    (format) => format.name === "DD+ ATMOS",
  );
  if (atmos === undefined) throw new Error("Atmos fixture missing");
  const sourceBundle = await f.guide.load("movie");
  const guideAtmos = sourceBundle.formats.find(
    (format) => format.name === atmos.name,
  );
  if (guideAtmos === undefined) throw new Error("Source Atmos fixture missing");
  const overrides = { [guideAtmos.trash_id]: 350 };
  const reviewed = await f.service.preview(owner, {
    kind: "movie",
    scoreOverrides: overrides,
  });
  const created = await f.service.apply(owner, "guide-with-override", {
    kind: "movie",
    scoreOverrides: overrides,
    expectedRevision: reviewed.revision,
    expectedContentHash: reviewed.contentHash,
    profileId: null,
    expectedVersion: 0,
  });
  const asset = await cluster.database.libraryAsset.create({
    data: {
      path: `/library/legacy-${crypto.randomUUID()}.mkv`,
      state: "published",
      owned: false,
      sizeBytes: 1234,
      properties: { legacyPlayable: true },
    },
  });
  f.changed();
  const refresh = qualityGuideActivities(cluster.database, f.guide);
  await refresh.refreshMediaQualityGuides();
  const updated = await cluster.database.qualityProfile.findUniqueOrThrow({
    where: { id: created.profileId },
  });
  expect(updated.version).toBe(2);
  const rules = QualityRulesSchema.parse(updated.rules);
  expect(rules.managedGuide?.scoreOverrides).toEqual(overrides);
  expect(
    rules.resolved?.profile.formatItems.find(
      (format) => format.name === "DD+ ATMOS",
    )?.score,
  ).toBe(350);
  expect(
    await cluster.database.qualityProfileVersion.count({
      where: { profileId: created.profileId },
    }),
  ).toBe(2);
  await refresh.refreshMediaQualityGuides();
  const unchanged = await cluster.database.qualityProfile.findUniqueOrThrow({
    where: { id: created.profileId },
  });
  expect(unchanged.version).toBe(2);
  f.invalid();
  await refresh.refreshMediaQualityGuides();
  expect(
    await cluster.database.qualityProfile.findUniqueOrThrow({
      where: { id: created.profileId },
    }),
  ).toEqual(updated);
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: asset.id },
    }),
  ).toEqual(asset);
  const failedStatus = await f.service.status(owner);
  expect(
    failedStatus.find((profile) => profile.id === created.profileId)?.lastSync,
  ).toMatchObject({
    status: "failed",
    reason: "guide_fetch_or_validation_failed",
  });
  await expect(
    cluster.database.qualityProfileVersion.update({
      where: {
        profileId_version: { profileId: created.profileId, version: 1 },
      },
      data: { rules: {} },
    }),
  ).rejects.toThrow("immutable");
});

test("an active reservation defers the current pointer until it drains without changing target generations", async () => {
  const f = fixture();
  const created = await createProfile(f, "series");
  const db = cluster.database;
  await grantTestLease(db);
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 0 },
  });
  await grantTestRequesterAccess(db, member.id, "fixture-server");
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Guide Reservation Fixture",
      tmdbId: 123_456,
    },
  });
  const media = await cluster.database.mediaItem.create({
    data: {
      kind: "episode",
      parentId: series.id,
      title: "First episode",
      originalLanguage: "en",
      runtimeMinutes: 45,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  const commands = new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
  await commands.assignProfile(owner, crypto.randomUUID(), media.id, {
    expectedVersion: media.version,
    profileId: created.profileId,
  });
  const requested = await commands.createRequest(member, crypto.randomUUID(), {
    mediaId: media.id,
    subtitleLanguages: [],
    includeSpecials: false,
    keepingPolicy: "temporary",
  });
  const operationId = z.uuid().parse(requested.operationId);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const input = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(operation.payload);
  await db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true },
    update: { enabled: true },
  });
  const context = createAutomationTestContext(
    db,
    new CredentialCipher(randomBytes(32).toString("base64")),
  );
  const listing = StoredCandidateSchema.parse({
    providerId: "knaben",
    providerReleaseId: crypto.randomUUID(),
    title: "Guide.Reservation.Fixture.S01E01.1080p.WEB-DL.H264.English-GROUP",
    sizeBytes: 2_000_000_000,
    seeders: 100,
    infoHash: "a".repeat(40),
    detailsUrl: "https://example.com",
    download: {
      kind: "magnet",
      value: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
    },
    references: [
      { namespace: "tmdb", value: String(series.tmdbId), kind: "series" },
    ],
  });
  context.providers = {
    withProvider: async (_id, work) =>
      work({ search: () => Promise.resolve([listing]) }),
  };
  const reservedProfile = await loadProfile(db, media.id);
  if (reservedProfile === null)
    throw new Error("Actual requested guide profile missing");
  const candidates = await searchCandidates(context, media.id, reservedProfile);
  expect(candidates).toHaveLength(1);
  const attemptId = await reserveCandidate(context, input, {
    releaseId: z.uuid().parse(candidates[0]),
    profile: reservedProfile,
    epoch: 0,
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: z.uuid().parse(attemptId) },
  });
  expect(attempt).toMatchObject({
    sponsorRequestId: requested.requestId,
    operationId,
    state: "reserved",
  });
  expect(
    await db.acquisitionReservation.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
    }),
  ).toMatchObject({ attemptId: attempt.id, generation: input.generation });
  const before = await cluster.database.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
  });
  f.changed();
  const refresh = qualityGuideActivities(cluster.database, f.guide);
  await refresh.refreshMediaQualityGuides();
  const deferred = await cluster.database.qualityProfile.findUniqueOrThrow({
    where: { id: created.profileId },
  });
  expect(deferred.version).toBe(1);
  const deferredStatus = await f.service.status(owner);
  expect(
    deferredStatus.find((profile) => profile.id === created.profileId)?.lastSync
      ?.status,
  ).toBe("deferred");
  await cluster.database.acquisitionReservation.delete({
    where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
  });
  await refresh.refreshMediaQualityGuides();
  const drained = await cluster.database.qualityProfile.findUniqueOrThrow({
    where: { id: created.profileId },
  });
  expect(drained.version).toBe(2);
  expect(
    await cluster.database.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
    }),
  ).toEqual(before);
});

test("English regular captions bind the actual assigned guide and canonical language, independently of requests", async () => {
  const f = fixture();
  const created = await createProfile(f, "series");
  const profile = await cluster.database.qualityProfile.findUniqueOrThrow({
    where: { id: created.profileId },
  });
  const foreign = await householdCaptionRequirements(
    cluster.database,
    profile,
    "ja",
  );
  expect(foreign.targets).toEqual([
    { language: "en", forced: false, hearingImpaired: "any" },
  ]);
  expect(foreign.binding).toMatchObject({
    profileId: profile.id,
    profileVersion: 1,
    originalLanguage: "ja",
    enabled: true,
  });
  const english = await householdCaptionRequirements(
    cluster.database,
    profile,
    "en",
  );
  const unknown = await householdCaptionRequirements(
    cluster.database,
    profile,
    null,
  );
  const unassigned = await householdCaptionRequirements(
    cluster.database,
    null,
    "ja",
  );
  expect(english.targets).toEqual([]);
  expect(unknown.reasons).toEqual(["subtitle_original_language_unknown"]);
  expect(unassigned.targets).toEqual([]);
  const series = await cluster.database.mediaItem.create({
    data: {
      kind: "series",
      title: "Foreign series fixture",
      originalLanguage: "ja",
    },
  });
  const episode = await cluster.database.mediaItem.create({
    data: {
      kind: "episode",
      title: "Foreign episode fixture",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
      intents: { create: { profileId: profile.id, automationEpoch: 0 } },
    },
  });
  const video = await cluster.database.libraryAsset.create({
    data: {
      path: `/library/${episode.id}.mkv`,
      state: "published",
      owned: true,
      ownershipEpoch: 0,
      checksum: "c".repeat(64),
      sizeBytes: 1000,
      properties: { audioLanguages: ["ja"] },
      coverage: { create: { mediaId: episode.id, current: true } },
    },
  });
  expect(
    await currentSubtitleWork(cluster.database, video.id, 0),
  ).toMatchObject({ targets: foreign.targets, protectedReasons: [] });
});
