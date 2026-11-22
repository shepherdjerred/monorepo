import { expect, test } from "vitest";
import { z } from "zod";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { legacyClaimsHarness } from "#infrastructure/recovery/legacy-claims/test-fixture.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { grantTestLease } from "#testing/authority.ts";
import { PrismaPersonalMigration } from "./service.ts";

const harness = legacyClaimsHarness();
const serverMachineId = "binding-fixture-server";
const sections = { movie: "1", series: "2" };
type SourceRequest = Extract<MigrationRecord, { kind: "request" }>;

async function setupAttachment() {
  const f = await harness.setup();
  const service = new PrismaPersonalMigration(f.db, {
    keepDays: 30,
    serverMachineId,
    sections,
  });
  const plexAccountId = String(
    crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
  );
  const movie: SourceRequest = {
    kind: "request",
    sourceId: "1",
    requesterSourceId: "7",
    plexAccountId,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: z.int().positive().parse(f.movie.tmdbId) },
    scope: "movie",
    seasons: [],
    active: true,
    sourceStatus: 5,
  };
  const admin = new PrismaMigrationAdministration(f.db);
  async function review(
    snapshot: ReturnType<typeof captureFixture>,
    selectedKeys?: string[],
  ) {
    const { captureId } = await admin.upload(f.owner, { snapshot });
    const selection = {
      captureIds: [captureId],
      movieEditions: [{ mediaId: f.movie.id, edition: "default" as const }],
      historyOnly: [],
      deferUnboundRequesters: true as const,
      ...(selectedKeys === undefined
        ? {}
        : {
            selectedSeerrRequests: selectedKeys.map((provenanceKey) => ({
              captureId,
              provenanceKey,
            })),
          }),
    };
    const preview = await service.preview(f.owner, selection);
    expect(preview.blocked).toBe(false);
    await service.apply(f.owner, crypto.randomUUID(), {
      ...selection,
      previewHash: preview.previewHash,
      acknowledgeExistingLibraryKeep: true,
      acknowledgeTemporaryFollowingClaims: true,
    });
    return { captureId, claims: preview.claims };
  }
  const store = new PrismaAuthStore(f.db);
  const access = {
    accountId: plexAccountId,
    serverMachineId,
    permittedSectionIds: ["1", "2"],
    permittedMediaKinds: ["movie" as const, "series" as const],
    plexRestricted: false,
  };
  async function signIn() {
    const loginId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await store.saveLogin({
      id: loginId,
      pinId: 1,
      pinCode: "synthetic",
      browserHash: "synthetic-browser",
      encryptedDevice: "synthetic-device",
      expiresAt,
    });
    return store.completeLogin({
      loginId,
      now: new Date(),
      accountId: plexAccountId,
      displayName: "Family member",
      ownerAccountId: f.owner.plexAccountId,
      encryptedCredential: "synthetic-credential",
      access,
      sessionId: crypto.randomUUID(),
      csrfHash: "synthetic-csrf",
      expiresAt,
    });
  }
  return { ...f, access, movieRecord: movie, review, service, signIn, store };
}

test("reviews exact Seerr identities before signup and attaches only once within verified current authority", async () => {
  const f = await setupAttachment();
  const tv: SourceRequest = {
    ...f.movieRecord,
    sourceId: "2",
    externalIds: { tmdb: z.int().positive().parse(f.series.tmdbId) },
    scope: "season",
    seasons: [1],
    seasonStatuses: [{ season: 1, status: 2 }],
    sourceStatus: 2,
  };
  const archive: SourceRequest = {
    ...f.movieRecord,
    sourceId: "3",
    active: false,
    requestedAt: "2021-06-02T09:10:11.000Z",
    sourceStatus: 3,
  };
  const snapshot = captureFixture("seerr", [f.movieRecord, tv, archive]);
  const review = await f.review(snapshot);
  expect(review.claims.map((claim) => claim.disposition)).toEqual([
    "deferred",
    "deferred",
    "history",
  ]);
  expect(
    await f.db.mediaUser.findUnique({
      where: { plexAccountId: f.access.accountId },
    }),
  ).toBeNull();
  expect(
    await f.db.mediaRequest.count({
      where: { mediaId: { in: [f.movie.id, f.season.id] } },
    }),
  ).toBe(0);
  expect(await f.service.attachImportedRequests(f.subject)).toBe(0);
  expect(await f.service.importedHistory(f.subject)).toEqual([]);

  const actor = await f.signIn();
  const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: actor.id },
  });
  expect(mapping.serverAccountId).toBeNull();
  await f.store.updateAccess(actor.id, {
    ...f.access,
    permittedSectionIds: ["2"],
    permittedMediaKinds: ["series"],
  });
  expect(await f.service.attachImportedRequests(actor)).toBe(0);
  expect(await f.service.importedHistory(actor)).toEqual([]);
  await f.store.updateAccess(actor.id, f.access);
  expect(await f.service.importedHistory(actor)).toEqual([
    expect.objectContaining({
      title: f.movie.title,
      requestedAt: archive.requestedAt,
      sourceStatus: 3,
    }),
  ]);
  const counts = await Promise.all([
    f.service.attachImportedRequests(actor),
    f.service.attachImportedRequests(actor),
  ]);
  expect(counts.sort((a, b) => a - b)).toEqual([0, 1]);
  expect(await f.service.imported(actor)).toEqual([
    expect.objectContaining({
      mediaId: f.movie.id,
      needsAcquisitionChoice: true,
    }),
  ]);
  expect(await f.db.operation.count({ where: { userId: actor.id } })).toBe(0);
  expect(
    await f.db.seerrRequestApproval.findUniqueOrThrow({
      where: { provenanceKey: recordKey(snapshot, tv) },
    }),
  ).toMatchObject({ pending: true });

  await grantTestLease(f.db);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
  expect(await f.service.attachImportedRequests(actor)).toBe(1);
  expect(await f.service.attachImportedRequests(actor)).toBe(0);
  expect(
    await f.db.mediaRequest.findMany({
      where: { userId: actor.id },
      select: { active: true, movieEditionChoiceId: true },
    }),
  ).toEqual([
    { active: true, movieEditionChoiceId: null },
    { active: true, movieEditionChoiceId: null },
  ]);
  expect(
    await f.db.operation.count({
      where: {
        userId: actor.id,
        kind: "expand_request",
        targetId: f.season.id,
      },
    }),
  ).toBe(1);
  expect(
    await f.db.legacyRequesterBinding.count({
      where: { captureId: review.captureId, userId: actor.id },
    }),
  ).toBe(1);
});

test("a newer history decision supersedes a pending request and cannot be reversed by reviewing the earlier capture", async () => {
  const f = await setupAttachment();
  const prior = captureFixture("seerr", [f.movieRecord]);
  await f.review(prior);
  await f.review({
    ...captureFixture("seerr", [
      { ...f.movieRecord, active: false, sourceStatus: 3 },
    ]),
    sourceInstanceId: prior.sourceInstanceId,
    startedAt: "2026-10-18T00:00:00Z",
    completedAt: "2026-10-18T00:01:00Z",
  });
  await f.review(prior);
  const actor = await f.signIn();
  expect(await f.service.attachImportedRequests(actor)).toBe(0);
  expect(await f.db.mediaRequest.count({ where: { userId: actor.id } })).toBe(
    0,
  );
  expect(await f.service.importedHistory(actor)).toEqual([
    expect.objectContaining({ sourceStatus: 3, title: f.movie.title }),
  ]);
});

test("a full newer capture retires omitted approvals before an account signs in", async () => {
  const f = await setupAttachment();
  const tv: SourceRequest = {
    ...f.movieRecord,
    externalIds: { tmdb: z.int().positive().parse(f.series.tmdbId) },
    scope: "season",
    seasons: [1],
    seasonStatuses: [{ season: 1, status: 2 }],
    sourceStatus: 2,
  };
  const unstaged = { ...f.movieRecord, sourceId: "2" };
  const prior = captureFixture("seerr", [tv, unstaged]);
  const tvKey = recordKey(prior, tv);
  await f.review(prior, [tvKey]);
  const subsetRecord = {
    ...f.movieRecord,
    sourceId: "3",
    active: false,
    sourceStatus: 3,
  };
  const subset = {
    ...captureFixture("seerr", [subsetRecord]),
    sourceInstanceId: prior.sourceInstanceId,
    startedAt: "2026-10-17T02:00:00Z",
    completedAt: "2026-10-17T02:01:00Z",
  };
  await f.review(subset, [recordKey(subset, subsetRecord)]);
  expect(
    await f.db.seerrRequestApproval.findUniqueOrThrow({
      where: { provenanceKey: tvKey },
    }),
  ).toMatchObject({ pending: true });
  await f.review({
    ...captureFixture("seerr"),
    sourceInstanceId: prior.sourceInstanceId,
    startedAt: "2026-10-18T00:00:00Z",
    completedAt: "2026-10-18T00:01:00Z",
  });
  await f.review(prior);
  const actor = await f.signIn();
  await grantTestLease(f.db);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
  expect(await f.service.attachImportedRequests(actor)).toBe(0);
  expect(await f.db.mediaRequest.count({ where: { userId: actor.id } })).toBe(
    0,
  );
  expect(await f.db.operation.count({ where: { userId: actor.id } })).toBe(0);
});
