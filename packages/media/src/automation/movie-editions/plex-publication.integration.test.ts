import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { rm, readFile } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { moviePlexV4Fixture } from "#testing/movie-plex-v4.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MoviePlexReceiptV2Schema } from "#shared/movie-editions/plex-v2.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRequestFulfillment } from "#infrastructure/movie-editions/fulfillment.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { visibleMovieRequests } from "#infrastructure/visibility/movie-requests.ts";
import { publishMoviePlexV4 } from "./plex-publication.ts";
import { finalizeMovieAcquisitionV4 } from "./finalization.ts";

const h = automationTestHarness();
const directories: string[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(edition: MovieEditionKey = "extended_cut") {
  const f = await moviePlexV4Fixture(
    h.database(),
    h.context(),
    await h.fixture(),
    { edition, bytes },
  );
  directories.push(f.files.directory);
  return f;
}

test.each(MovieEditionKeySchema.options)(
  "actual request-to-file %s pipeline records exact Plex availability and literal completion retry",
  async (edition) => {
    const f = await fixture(edition);
    const fulfillmentInput = {
      requestId: f.result.requestId,
      currentAsset: { assetId: f.asset.id, assetVersion: f.asset.version },
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
    };
    expect(
      await readMovieRequestFulfillment(h.database(), fulfillmentInput),
    ).not.toMatchObject({ status: "fulfilled" });
    await expect(
      publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
    ).resolves.toEqual({ status: "available", reason: null });
    expect(
      await readMovieRequestFulfillment(h.database(), fulfillmentInput),
    ).toEqual({ status: "fulfilled", reason: null });
    const visible = await visibleMovieRequests(h.database(), {
      media: f.media,
      userId: f.result.subjectUserId,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    });
    expect(visible.find((row) => row.edition === edition)).toMatchObject({
      requestId: f.result.requestId,
      fulfillment: { status: "fulfilled", reason: null },
    });
    if (edition !== "default")
      expect(
        visible.find((row) => row.edition === "default")?.fulfillment.status,
      ).not.toBe("fulfilled");
    const operation = await h
      .database()
      .operation.findUniqueOrThrow({ where: { id: f.input.operationId } });
    const raw = z
      .object({
        moviePlexReceiptV2: z.strictObject({
          receipt: z.json(),
          receiptHash: z.string(),
        }),
      })
      .parse(operation.result).moviePlexReceiptV2;
    const receipt = MoviePlexReceiptV2Schema.parse(raw.receipt);
    expect(raw.receiptHash).toBe(identityHash(raw.receipt));
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      input: f.input,
      observation: {
        associations: [
          {
            schemaVersion: 2,
            scope: { mediaId: f.media.id, edition },
            item: {
              ratingKey: f.item.ratingKey,
              editionTitle: MOVIE_EDITION_REGISTRY[edition].plexLabel || null,
            },
          },
        ],
      },
    });
    expect(
      await h.database().mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition } },
      }),
    ).toMatchObject({ availability: "available" });
    const scope = { mediaId: f.media.id, edition };
    const binding = await readCurrentPlexBinding(h.database(), {
      scope,
      assetId: f.asset.id,
      access: {
        serverMachineId: "fixture-server",
        sectionId: "1",
        sectionType: "movie",
      },
    });
    expect(binding).toMatchObject({
      status: "current",
      association: { schemaVersion: 2, scope, group: { assetId: f.asset.id } },
    });
    expect(
      await h
        .database()
        .mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
    ).toMatchObject({
      availability: edition === "default" ? "available" : f.media.availability,
    });
    expect(await readFile(f.source)).toEqual(Buffer.from(bytes));
    const budget = new PublicationAuthorityReadBudget();
    const physical = await snapshotMoviePublicationAssetV2(
      h.database(),
      f.input.scope,
      f.asset.id,
      budget,
    );
    expect(
      await findMoviePublicationReferenceV2(
        h.database(),
        { scope: f.input.scope, asset: physical },
        budget,
      ),
    ).toMatchObject({
      kind: "movie_publication_transition_v2",
      scope: f.input.scope,
      assetId: f.asset.id,
    });
    await finalizeMovieAcquisitionV4(
      f.network,
      f.input,
      testPlexBindingExecution(),
    );
    const completed = await h.database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    });
    expect(completed.state).toBe("completed");
    expect(
      await h
        .database()
        .acquisitionReservation.count({ where: { attemptId: completed.id } }),
    ).toBe(0);
    expect(
      await h.database().operation.findUniqueOrThrow({
        where: { idempotencyKey: `seed:${String(completed.torrentId)}` },
      }),
    ).toMatchObject({
      kind: "maintain_torrent",
      targetId: completed.torrentId,
    });
    const captions = await h.database().operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
    });
    expect(captions).toHaveLength(2);
    expect(
      captions.map(
        (row) => z.object({ scope: z.unknown() }).parse(row.payload).scope,
      ),
    ).toEqual([f.input.scope, f.input.scope]);
    const calls = f.calls.length;
    await h.database().mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "observe", ownershipConfirmed: false },
    });
    f.network.gates.acquisition = () => Promise.resolve(false);
    f.network.permittedSections = () =>
      Promise.reject(
        new Error("Historical ACK must precede dynamic configuration"),
      );
    await expect(
      publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
    ).resolves.toEqual({ status: "available", reason: null });
    await finalizeMovieAcquisitionV4(
      f.network,
      f.input,
      testPlexBindingExecution(),
    );
    expect(
      await h.database().operation.count({
        where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
      }),
    ).toBe(2);
    expect(f.calls).toHaveLength(calls);
    expect(
      await h
        .database()
        .operation.findUniqueOrThrow({ where: { id: operation.id } }),
    ).toEqual(operation);
    await expect(
      h.database().operation.update({
        where: { id: operation.id },
        data: {
          result: {
            moviePlexReceiptV2: { ...raw, receiptHash: "a".repeat(64) },
          },
        },
      }),
    ).rejects.toThrow("Committed movie Plex receipt");
  },
);

test("unverified movie publication cannot release reservations or queue downstream work", async () => {
  const f = await fixture("directors_cut");
  await expect(
    finalizeMovieAcquisitionV4(f.network, f.input, testPlexBindingExecution()),
  ).rejects.toMatchObject({ reason: "missing_binding" });
  expect(
    await h.database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    }),
  ).toMatchObject({ state: "imported" });
  expect(
    await h.database().acquisitionReservation.count({
      where: { attemptId: f.input.attemptId },
    }),
  ).toBe(1);
  expect(
    await h.database().operation.count({
      where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
    }),
  ).toBe(0);
});

test.each(["writer", "invocation"] as const)(
  "original %s expiry prevents movie finalization effects",
  async (mode) => {
    const f = await fixture("final_cut");
    const originalAttempt = await h
      .database()
      .acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.input.attemptId },
      });
    const seeding = await h.database().operation.findUniqueOrThrow({
      where: { idempotencyKey: `seed:${String(originalAttempt.torrentId)}` },
    });
    expect(
      await publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    let execution = testPlexBindingExecution();
    if (mode === "writer")
      await h.database().legacyWriterLease.update({
        where: { id: "singleton" },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
    else
      execution = {
        ...execution,
        observed: {
          wall: execution.observed.wall - 60_001,
          monotonic: execution.observed.monotonic - 60_001,
        },
        expiresAtMs: execution.expiresAtMs - 60_001,
      };
    await expect(
      finalizeMovieAcquisitionV4(f.network, f.input, execution),
    ).rejects.toMatchObject({
      reason: mode === "writer" ? "ownership_changed" : "verification_expired",
    });
    const attempt = await h.database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    });
    expect(attempt.state).toBe("imported");
    expect(
      await h
        .database()
        .acquisitionReservation.count({ where: { attemptId: attempt.id } }),
    ).toBe(1);
    expect(
      await h.database().operation.findUniqueOrThrow({
        where: { idempotencyKey: `seed:${String(attempt.torrentId)}` },
      }),
    ).toEqual(seeding);
    expect(
      await h.database().operation.count({
        where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
      }),
    ).toBe(0);
  },
);

test("wrong Plex edition preserves importing state and grants no completion or binding", async () => {
  const f = await fixture();
  f.item.editionTitle = "Theatrical Cut";
  await expect(
    publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).resolves.toEqual({ status: "waiting", reason: "metadata_changed" });
  expect(
    await h
      .database()
      .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ plexPublishedAt: null });
  expect(
    await h.database().mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: {
          mediaId: f.media.id,
          edition: f.input.scope.edition,
        },
      },
    }),
  ).toMatchObject({ availability: "importing" });
  expect(
    await h
      .database()
      .plexBindingCurrent.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
});

test("Plex availability cannot outlive the original writer observation during network verification", async () => {
  const f = await fixture();
  const expiry = Date.now() + 1000;
  await h.database().legacyWriterLease.update({
    where: { id: "singleton" },
    data: { expiresAt: new Date(expiry) },
  });
  let machines = 0;
  f.checkpoint((url) => {
    if (url.pathname === "/identity" && ++machines === 2)
      vi.spyOn(Date, "now").mockReturnValue(expiry + 1);
    return Promise.resolve();
  });
  await expect(
    publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).resolves.toEqual({ status: "waiting", reason: "verification_expired" });
  expect(
    await h
      .database()
      .plexBindingCurrent.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  expect(
    await h
      .database()
      .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ plexPublishedAt: null });
});

test("concurrent actual Plex publication retries share one immutable completion and claim revision", async () => {
  const f = await fixture();
  expect(
    await Promise.all([
      publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
      publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
    ]),
  ).toEqual([
    { status: "available", reason: null },
    { status: "available", reason: null },
  ]);
  const scope = { mediaId: f.media.id, edition: f.input.scope.edition };
  expect(
    await h.database().plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: scope },
    }),
  ).toMatchObject({ revision: 1 });
  expect(
    await h.database().plexAssociationEvidence.count({ where: scope }),
  ).toBe(1);
  expect(await h.database().plexItemClaim.count({ where: scope })).toBe(1);
});

test("a metadata-only verification timestamp cannot grant publication lineage without actual Plex completion", async () => {
  const f = await fixture();
  await h.database().libraryAsset.update({
    where: { id: f.asset.id },
    data: { plexPublishedAt: new Date() },
  });
  const budget = new PublicationAuthorityReadBudget();
  const asset = await snapshotMoviePublicationAssetV2(
    h.database(),
    f.input.scope,
    f.asset.id,
    budget,
  );
  await expect(
    findMoviePublicationReferenceV2(
      h.database(),
      { scope: f.input.scope, asset },
      budget,
    ),
  ).rejects.toThrow("one exact Plex completion");
});

test("cancel during actual Plex observations prevents availability without deleting the published file or source", async () => {
  const f = await fixture();
  let machines = 0;
  f.checkpoint(async (url) => {
    if (url.pathname !== "/identity" || ++machines !== 2) return;
    const user = await h
      .database()
      .mediaUser.findUniqueOrThrow({ where: { id: f.result.subjectUserId } });
    await f.commands.cancelMovieEditionRequest(
      { ...user, role: "member" },
      crypto.randomUUID(),
      {
        schemaVersion: 3,
        action: "cancel_request",
        subjectUserId: user.id,
        scope: f.input.scope,
        requestId: f.result.requestId,
        expected: {
          targetVersion: f.result.applied.targetVersion,
          requestVersion: f.result.applied.requestVersion,
          choiceRevision: f.result.applied.choiceRevision,
        },
      },
    );
  });
  await expect(
    publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).resolves.toMatchObject({ status: "obsolete" });
  expect(
    await h
      .database()
      .plexBindingCurrent.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  expect(
    await h
      .database()
      .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({ plexPublishedAt: null, state: "published" });
  expect(await readFile(f.source)).toEqual(Buffer.from(bytes));
});
