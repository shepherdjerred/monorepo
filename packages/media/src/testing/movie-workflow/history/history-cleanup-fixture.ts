import path from "node:path";
import { z } from "zod";
import { expect } from "vitest";
import { createMovieHistoryFixture } from "./history-review-fixture.ts";
import { movieWorkflowWire } from "#testing/movie-workflow/wire.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { MovieHistoryDetailV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { queueLibraryMovieDue } from "#automation/reconciliation/library-movies.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type History = Awaited<ReturnType<typeof createMovieHistoryFixture>>;

/** Genuine initial-library history release precedes a new Media-created management upgrade. */
export async function createMovieHistoryCleanupFixture(bytes: {
  original: Uint8Array;
  upgrade: Uint8Array;
}) {
  const f = await createMovieHistoryFixture("default", bytes.original, {
    actualMovieExclusion: true,
    movieMetadata: { year: 2020, runtimeMinutes: 1, originalLanguage: "en" },
  });
  try {
    const released = await releaseActualSeerrHistory(f);
    const retained = await f.db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(released.operationId) },
    });
    const retentionInput = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(retained.payload),
    );
    const part = f.original.item().Media?.[0]?.Part[0];
    if (part === undefined)
      throw new Error("Actual original binding omitted its Part");
    const originalWire = movieWorkflowWire(f.db, {
      mediaId: f.scope.mediaId,
      edition: f.scope.edition,
      bytes: bytes.original,
      downloads: f.original.files.roots.movies.downloads,
      ratingKey: f.original.item().ratingKey,
      partId: part.id,
      playback: { viewCount: 3, lastViewedAt: 1_234_567, viewOffset: 456_000 },
    });
    const evaluated = await createMovieNetworkFacetV4({
      ...f.original.context,
      plex: originalWire.plex,
      userPlex: originalWire.userPlex,
    }).evaluateMovieRetentionV4(retentionInput, testPlexBindingExecution());
    expect(evaluated).toMatchObject({
      status: "protected",
      reason: "owner_only_or_unclaimed",
    });
    await createOutboxActivities(f.db, () =>
      Promise.reject(new Error("No synthetic workflow terminal state")),
    ).finishMediaOperation({
      operationId: retained.id,
      status: "completed",
      reason: evaluated.reason,
    });
    expect(originalWire.additions()).toBe(0);
    const prepared = await prepareHistoryUpgrade(f, bytes.upgrade);
    const movie = createMovieNetworkFacetV4(prepared.context);
    const fileMovie = createMovieFileFacetV4(prepared.files);
    const operationId = await queueLibraryMovieDue(prepared.context, f.scope);
    if (operationId === null)
      throw new Error(
        "Actual released owner monitoring did not queue its upgrade",
      );
    const queued = await f.db.operation.findUniqueOrThrow({
      where: { id: operationId },
    });
    const command = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(queued.payload),
    );
    const reserved = await movie.reconcileMovieIntentV4(
      command,
      testPlexBindingExecution(),
    );
    expect(reserved).toMatchObject({ status: "acquire" });
    const input = {
      schemaVersion: 4 as const,
      operationId,
      scope: f.scope,
      attemptId: z.uuid().parse(reserved.attemptId),
    };
    expect(
      await movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await fileMovie.inspectAndStageMovieV4(input, testPublicationExecution()),
    ).toEqual({ status: "staged" });
    expect(
      await fileMovie.prepareMoviePublicationV4(
        input,
        testPublicationExecution(),
        new PublicationAuthorityReadBudget(),
      ),
    ).toEqual({ status: "prepared" });
    expect(
      await fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    expect(
      await movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    const cleanup = await f.db.upgradeCleanup.findFirstOrThrow({
      where: { assetId: f.original.asset.id },
    });
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { idempotencyKey: `upgrade-cleanup:${cleanup.id}` },
    });
    const old = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: cleanup.assetId },
    });
    const successor = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: cleanup.successorAssetId },
    });
    const policyTime = new Date(cleanup.expiresAt.getTime() + 1);
    return {
      ...f,
      ...prepared,
      released,
      cleanup,
      old,
      successor,
      input,
      context: { ...prepared.context, now: () => policyTime },
      files: { ...prepared.files, now: () => policyTime },
      cleanupInput: { operationId: operation.id, cleanupId: cleanup.id },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

async function releaseActualSeerrHistory(f: History) {
  const request: MigrationRecord = {
    kind: "request",
    sourceId: "history-cleanup-request",
    requesterSourceId: "7",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: z.number().parse(f.original.network.media.tmdbId) },
    scope: "movie",
    seasons: [],
    active: true,
  };
  const timestamp = new Date().toISOString();
  const uploaded = await new PrismaMigrationAdministration(f.db).upload(
    f.owner,
    {
      snapshot: {
        schemaVersion: 1,
        sourceKind: "seerr",
        sourceVersion: "3.0.0",
        sourceInstanceId: snapshotHash("synthetic-history-cleanup-seerr"),
        startedAt: timestamp,
        completedAt: timestamp,
        records: [request],
        endpoints: [
          {
            name: "requests",
            pages: 1,
            records: 1,
            complete: true,
            stable: true,
            digest: recordDigest([request]),
            reason: "complete",
          },
        ],
      },
    },
  );
  const bindings = new PrismaLegacyRequesterBindings(
    f.db,
    f.settings.serverMachineId,
  );
  const candidates = await bindings.list(f.owner, uploaded.captureId);
  const candidate = candidates.requesters[0];
  if (candidate === undefined)
    throw new Error("Actual cleanup source requester missing");
  await bindings.bind(f.owner, crypto.randomUUID(), {
    captureId: uploaded.captureId,
    requesterSourceId: candidate.requesterSourceId,
    requesterEvidenceHash: candidate.requesterEvidenceHash,
    userId: f.owner.id,
    expectedRevision: candidate.latestRevision,
    acknowledgeIdentityOnly: true,
  });
  const captured = await f.prepare();
  const subject = captured.detail.scope.users.find(
    (person) => person.id === f.owner.id,
  );
  if (subject === undefined)
    throw new Error(
      "Actual library owner missing from complete household review",
    );
  await f.service.respond(
    f.owner,
    crypto.randomUUID(),
    captured.result.recoveryReviewId,
    {
      schemaVersion: 3,
      scope: f.scope,
      scopeHash: captured.detail.scopeHash,
      subjectUserId: f.owner.id,
      definition: captured.detail.scope.definition,
      registryVersion: 1,
      declaration: { intent: "no_longer_request" },
      claimAcknowledgements: subject.claimAcknowledgements,
      acknowledgeMissingHistory: true,
    },
  );
  await f.declareRemaining(captured.result.recoveryReviewId);
  const ready = MovieHistoryDetailV3Schema.parse(
    await f.service.detail(f.owner, captured.result.recoveryReviewId),
  );
  return f.service.release(f.owner, crypto.randomUUID(), ready.id, {
    schemaVersion: 3,
    scope: f.scope,
    expectedVersion: ready.version,
    scopeHash: ready.scopeHash,
    responseHash: ready.responseHash,
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
}

async function prepareHistoryUpgrade(f: History, upgrade: Uint8Array) {
  const media = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: f.scope.mediaId },
  });
  const files = f.original.files;
  const mapping = files.pathMapping;
  if (mapping === undefined)
    throw new Error("Actual history fixture lost canonical file mapping");
  files.pathMapping = {
    canonical: (kind, root, relative) =>
      mapping.canonical(kind, root, relative),
    local: (stored) =>
      stored.startsWith("/downloads/")
        ? path.join(
            files.roots.movies.downloads,
            stored.slice("/downloads/".length),
          )
        : mapping.local(stored),
  };
  const original = f.original.item();
  const part = original.Media?.[0]?.Part[0];
  if (part === undefined)
    throw new Error("Actual initial-library Plex Part missing");
  const wire = movieWorkflowWire(f.db, {
    mediaId: media.id,
    edition: f.scope.edition,
    title: media.title,
    year: z.number().parse(media.year),
    downloads: files.roots.movies.downloads,
    bytes: upgrade,
    resolution: 2160,
    sceneStyle: true,
    providerReleaseId: `synthetic-history-upgrade:${media.id}`,
    ratingKey: original.ratingKey,
    partId: part.id,
    playback: { viewCount: 3, lastViewedAt: 1_234_567, viewOffset: 456_000 },
  });
  await f.db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    update: { enabled: true },
  });
  return { files, wire, context: { ...f.original.context, ...wire } };
}
