import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryFixture } from "#testing/movie-workflow/history/history-review-fixture.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { MovieHistoryDetailV3Schema } from "#shared/movie-editions/history-review-v3.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { hasPendingMovieLegacyClaimsV3 } from "#infrastructure/recovery/legacy-claims/movie/protection.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PlexClient } from "#integrations/plex.ts";
import { evaluateMovieRetentionV4 } from "#automation/movie-editions/retention/evaluate.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test.each(["default", "directors_cut"] as const)(
  "actual %s Seerr accounting needs explicit cut review and cannot release another cut",
  async (edition) => {
    const f = await createMovieHistoryFixture(edition, bytes);
    closers.push(f.close);
    const context = await new PrismaMediaApplication(
      f.db,
      f.settings,
    ).getMovieEditionContext(f.owner, f.scope.mediaId, f.owner.id);
    const selected = context.options.find((row) => row.edition === "final_cut");
    if (selected === undefined)
      throw new Error("Actual sibling cut option disappeared");
    const sibling = { ...f.scope, edition: "final_cut" as const };
    await f.commands.requestMovieEditionV4(f.owner, crypto.randomUUID(), {
      schemaVersion: 4,
      mediaId: sibling.mediaId,
      subjectUserId: f.owner.id,
      expected: {
        mediaVersion: context.mediaVersion,
        targetVersion: selected.targetVersion,
        definition: selected.storedDefinition,
        request: null,
      },
      selection: {
        edition: sibling.edition,
        definitionVersion: selected.definitionVersion,
        definitionDigest: selected.definitionDigest,
        registryVersion: context.registryVersion,
      },
      options: { subtitleLanguages: ["en"] },
    });
    const request: MigrationRecord = {
      kind: "request",
      sourceId: "movie-history-seerr-request-7",
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
          sourceInstanceId: snapshotHash("synthetic-history-seerr-boundary"),
          sourceVersion: "3.0.0",
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
    const protectedReview = await f.prepare();
    expect(protectedReview.detail.scope.blockers).toContain(
      "legacy_claim_requester_unmapped",
    );
    const bindings = new PrismaLegacyRequesterBindings(
      f.db,
      f.settings.serverMachineId,
    );
    const view = await bindings.list(f.owner, uploaded.captureId);
    const requester = view.requesters[0];
    if (requester === undefined)
      throw new Error("Actual uploaded Seerr requester missing");
    await bindings.bind(f.owner, crypto.randomUUID(), {
      captureId: uploaded.captureId,
      requesterSourceId: requester.requesterSourceId,
      requesterEvidenceHash: requester.requesterEvidenceHash,
      userId: f.owner.id,
      expectedRevision: requester.latestRevision,
      acknowledgeIdentityOnly: true,
    });
    const capture = await f.db.migrationCapture.findUniqueOrThrow({
      where: { id: uploaded.captureId },
    });
    const originalRecords = await f.db.migrationRecord.findMany({
      where: { captureId: capture.id },
      orderBy: { provenanceKey: "asc" },
    });
    const binding = await f.db.legacyRequesterBinding.findFirstOrThrow({
      where: { captureId: capture.id },
    });
    expect(
      await f.db.mediaRequest.count({
        where: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      }),
    ).toBe(0);
    const reviewed = await f.prepare();
    expect(reviewed.detail.scope.blockers).toEqual([]);
    expect(reviewed.detail.scope.legacyClaims).toHaveLength(1);
    const subject = reviewed.detail.scope.users.find(
      (row) => row.id === f.owner.id,
    );
    if (subject === undefined)
      throw new Error("Actual reviewed requester disappeared");
    await f.service.respond(
      f.owner,
      crypto.randomUUID(),
      reviewed.result.recoveryReviewId,
      {
        schemaVersion: 3,
        scope: f.scope,
        scopeHash: reviewed.detail.scopeHash,
        subjectUserId: f.owner.id,
        definition: reviewed.detail.scope.definition,
        registryVersion: 1,
        declaration: { intent: "no_longer_request" },
        claimAcknowledgements: subject.claimAcknowledgements,
        acknowledgeMissingHistory: true,
      },
    );
    await f.declareRemaining(reviewed.result.recoveryReviewId);
    const ready = MovieHistoryDetailV3Schema.parse(
      await f.service.detail(f.owner, reviewed.result.recoveryReviewId),
    );
    const released = await f.service.release(
      f.owner,
      crypto.randomUUID(),
      ready.id,
      {
        schemaVersion: 3,
        scope: f.scope,
        expectedVersion: ready.version,
        scopeHash: ready.scopeHash,
        responseHash: ready.responseHash,
        confirmHouseholdBaseline: true,
        confirmExistingPins: true,
        acknowledgeMissingHistory: true,
      },
    );
    const epoch = ready.scope.recoveryEpoch;
    const pending = (scope: typeof f.scope) =>
      f.db.$transaction(
        async (tx) => {
          await lockMovieCommand(tx, scope);
          return hasPendingMovieLegacyClaimsV3(
            tx,
            { scope, epoch },
            new PublicationAuthorityReadBudget(),
          );
        },
        { isolationLevel: "Serializable", timeout: 15_000 },
      );
    expect(await pending(f.scope)).toBe(false);
    expect(await pending(sibling)).toBe(true);
    if (edition === "default")
      await assertDefaultRetentionAcceptance(f, {
        operationId: z.uuid().parse(released.operationId),
        receiptId: z.uuid().parse(released.recoveryReceiptId),
      });
    expect(
      await f.db.migrationCapture.findUniqueOrThrow({
        where: { id: capture.id },
      }),
    ).toEqual(capture);
    expect(
      await f.db.migrationRecord.findMany({
        where: { captureId: capture.id },
        orderBy: { provenanceKey: "asc" },
      }),
    ).toEqual(originalRecords);
    expect(
      await f.db.legacyRequesterBinding.findUniqueOrThrow({
        where: { id: binding.id },
      }),
    ).toEqual(binding);
    expect(await f.db.libraryAsset.count()).toBe(1);
    expect(await f.db.acquisitionAttempt.count()).toBe(0);
  },
  60_000,
);

async function assertDefaultRetentionAcceptance(
  f: Awaited<ReturnType<typeof createMovieHistoryFixture>>,
  proof: { operationId: string; receiptId: string },
) {
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: proof.operationId },
  });
  const input = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
  const plex = new PlexClient(
    {
      baseUrl: "http://history-plex.fixture",
      token: "synthetic-history-server",
      clientIdentifier: "history-review",
    },
    (url) => {
      if (url.pathname === "/identity")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              machineIdentifier: f.settings.serverMachineId,
            },
          }),
        );
      if (url.pathname === "/library/sections")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 1,
              Directory: [
                {
                  key: f.settings.movieSectionId,
                  type: "movie",
                  title: "Movies",
                },
              ],
            },
          }),
        );
      if (url.pathname === "/status/sessions")
        return Promise.resolve(
          Response.json({ MediaContainer: { size: 0, Metadata: [] } }),
        );
      if (url.pathname === `/library/sections/${f.settings.movieSectionId}/all`)
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 1,
              totalSize: 1,
              Metadata: [f.original.item()],
            },
          }),
        );
      if (url.pathname === `/library/metadata/${f.original.item().ratingKey}`)
        return Promise.resolve(
          Response.json({
            MediaContainer: { size: 1, Metadata: [f.original.item()] },
          }),
        );
      return Promise.reject(
        new Error(
          `Unexpected actual history-retention Plex request ${url.pathname}`,
        ),
      );
    },
  );
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  expect(
    await evaluateMovieRetentionV4(
      {
        ...f.original.context,
        plex,
        movieManagement: { execution, budget },
      },
      input,
      execution,
    ),
  ).toMatchObject({
    status: "protected",
    reason: "owner_only_or_unclaimed",
  });
  expect(() => budget.consume(0)).not.toThrow();
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  ).toMatchObject({
    releasedById: f.owner.id,
    releaseEvidence: { receiptId: proof.receiptId },
  });
}
