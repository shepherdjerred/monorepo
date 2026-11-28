import { expect, test } from "vitest";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { planSubtitleTargetV1 } from "#automation/subtitle-maintenance/planning.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { replacePlexClaims } from "#infrastructure/plex-binding/claims.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { legacyClaimsHarness } from "#infrastructure/recovery/legacy-claims/test-fixture.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { grantTestLease } from "#testing/authority.ts";
import { captureHasUniquePlexRequester } from "./seerr-attachment-binding.ts";
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

type QueryTracker = {
  inFlight: number;
  maxInFlight: number;
  overlaps: number;
};

function trackPromiseLike(result: unknown, tracker: QueryTracker): unknown {
  if (
    result === null ||
    (typeof result !== "object" && typeof result !== "function") ||
    !("then" in result) ||
    typeof result.then !== "function"
  ) {
    return result;
  }
  tracker.inFlight++;
  tracker.maxInFlight = Math.max(tracker.maxInFlight, tracker.inFlight);
  if (tracker.inFlight > 1) {
    tracker.overlaps++;
  }
  return Promise.resolve(result).finally(() => {
    tracker.inFlight--;
  });
}

function wrapModelDelegate<T extends object>(
  delegate: T,
  tracker: QueryTracker,
): T {
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (...args: unknown[]) =>
            trackPromiseLike(Reflect.apply(value, target, args), tracker)
        : value;
    },
  });
}

function guardSequentialTransaction<T extends object>(rawTx: T) {
  const tracker: QueryTracker = { inFlight: 0, maxInFlight: 0, overlaps: 0 };
  const tx = new Proxy(rawTx, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) =>
          trackPromiseLike(Reflect.apply(value, target, args), tracker);
      }
      return typeof value === "object" && value !== null
        ? wrapModelDelegate(value, tracker)
        : value;
    },
  });
  return { tx, tracker };
}

test("interactive transaction helpers serialize single-client pg queries without overlapping execution", async () => {
  const positiveControl = guardSequentialTransaction({
    probe: {
      count: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 1;
      },
    },
  });
  await Promise.all([
    positiveControl.tx.probe.count(),
    positiveControl.tx.probe.count(),
  ]);
  expect(positiveControl.tracker.overlaps).toBeGreaterThan(0);

  const f = await setupAttachment();
  const warnings: string[] = [];
  const onWarning = (warning: Error) => {
    if (warning.message.includes("already executing a query")) {
      warnings.push(warning.message);
    }
  };
  process.on("warning", onWarning);
  try {
    const snapshot = captureFixture("seerr", [f.movieRecord]);
    const review = await f.review(snapshot);
    const actor = await f.signIn();
    await f.db.mediaIntent.createMany({
      data: [
        { mediaId: f.first.id, desiredPresence: true, monitoring: true },
        { mediaId: f.second.id, desiredPresence: true, monitoring: true },
      ],
      skipDuplicates: true,
    });
    const asset = await f.db.libraryAsset.create({
      data: {
        path: `/data/movies/${crypto.randomUUID()}/movie.mkv`,
        sizeBytes: 1024n,
        checksum: "a".repeat(64),
        state: "published",
        owned: true,
        ownershipEpoch: 0,
        properties: { audioLanguages: ["ja"] },
        coverage: {
          create: [
            { mediaId: f.first.id, current: true },
            { mediaId: f.second.id, current: true },
          ],
        },
      },
    });

    await f.db.$transaction(async (rawTx: Prisma.TransactionClient) => {
      const { tx, tracker } = guardSequentialTransaction(rawTx);
      expect(
        await captureHasUniquePlexRequester(tx, {
          captureId: review.captureId,
          requesterSourceId: f.movieRecord.requesterSourceId,
          plexAccountId: f.access.accountId,
        }),
      ).toBe(true);
      await replacePlexClaims(
        tx,
        { serverMachineId, oldGroups: [], members: [] },
        plexBindingFreshness({
          observed: { wall: Date.now(), monotonic: performance.now() },
          expiresAtMs: Date.now() + 60_000,
          guards: [],
        }),
      );
      const work = await currentSubtitleWork(tx, asset.id, 0);
      await planSubtitleTargetV1(tx, {
        work,
        resolved: {
          movieScope: undefined,
          access: undefined,
        },
        target: { language: "en", hearingImpaired: "any" },
        mode: "wanted",
        epoch: 0,
        now: new Date(),
      });
      expect(tracker.overlaps).toBe(0);
      expect(tracker.maxInFlight).toBe(1);
    });

    const attached = await Promise.all([
      f.service.attachImportedRequests(actor),
      f.service.attachImportedRequests(actor),
    ]);
    expect(attached.sort((a, b) => a - b)).toEqual([0, 1]);
    expect(warnings).toEqual([]);
  } finally {
    process.off("warning", onWarning);
  }
});
