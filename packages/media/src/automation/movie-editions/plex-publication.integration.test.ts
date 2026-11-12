import { afterEach, beforeAll, expect, onTestFinished, test, vi } from "vitest";
import { z } from "zod";
import { rm, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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
import { grantTestManagedStorage } from "#testing/managed-storage.ts";
import { captureExistingPlexBindingExpected } from "#infrastructure/plex-binding/cold.ts";
import { readPlexGroupUnion } from "#infrastructure/plex-binding/groups.ts";
import {
  parsePlexRecord,
  readPlexPointer,
} from "#infrastructure/plex-binding/records.ts";
import { PlexAssociationSchema } from "#shared/plex-binding/contract.ts";
import { sweepInventory } from "#automation/reconciliation/inventory.ts";
import { createPlexBindingActivities } from "#automation/plex-binding/activities.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { assertPlexBindingExpected } from "#infrastructure/plex-binding/authority.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { captureRetentionPlexProjection } from "#infrastructure/plex-binding/retention.ts";

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

async function inventoryPublicationHistory(
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const db = h.database();
  return {
    attempt: await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    }),
    publication: await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.input.attemptId },
    }),
    request: await db.mediaRequest.findUniqueOrThrow({
      where: { id: f.result.requestId },
    }),
    asset: await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
  };
}

async function inventoryFixture(edition: "default" | "extended_cut") {
  if (edition === "default")
    return { f: await fixture(edition), sibling: null };
  const db = h.database(),
    base = await h.fixture();
  const sibling = await moviePlexV4Fixture(db, h.context(), base, {
    edition: "default",
    bytes,
  });
  directories.push(sibling.files.directory);
  await publishMoviePlexV4(
    sibling.network,
    sibling.input,
    testPlexBindingExecution(),
  );
  await finalizeMovieAcquisitionV4(
    sibling.network,
    sibling.input,
    testPlexBindingExecution(),
  );
  if (sibling.media.tmdbId === null)
    throw new Error("Actual movie fixture has no canonical TMDB identity");
  const infoHash = randomBytes(20).toString("hex");
  const f = await moviePlexV4Fixture(
    db,
    h.context(),
    {
      ...base,
      source: {
        ...base.source,
        infoHash,
        download: { kind: "magnet", value: `magnet:?xt=urn:btih:${infoHash}` },
      },
    },
    {
      edition,
      bytes,
      tmdbId: sibling.media.tmdbId,
    },
  );
  directories.push(f.files.directory);
  expect(f.media.id).toBe(sibling.media.id);
  return { f, sibling };
}

async function seedInventoryConsequences(
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const db = h.database(),
    scope = { mediaId: f.media.id, edition: f.input.scope.edition };
  const { current } = await readPlexPointer(db, scope);
  if (current === null)
    throw new Error(
      "Derived test observations require the actual published binding",
    );
  const authority = { purpose: "current_serving", binding: current.snapshot };
  const observedAt = new Date();
  await db.plexWatchProjection.create({
    data: {
      userId: f.result.subjectUserId,
      ...scope,
      evidenceId: current.snapshot.evidenceId,
      associationHash: current.snapshot.associationHash,
      bindingRevision: current.snapshot.revision,
      purpose: "current_serving",
      watchBatchRevision: 1n,
      observedAt,
      watched: true,
      source: "plex",
      authority,
      authorityHash: identityHash(authority),
    },
  });
  await db.watchState.create({
    data: {
      userId: f.result.subjectUserId,
      ...scope,
      watched: true,
      observedAt,
      source: "plex",
    },
  });
  await db.$transaction(async (tx) => {
    const target = await tx.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: scope },
    });
    const decision = await tx.retentionDecision.create({
      data: {
        ...scope,
        generation: target.generation,
        state: "eligible",
        evidence: {},
      },
    });
    // The historical V1 retention projection covers default cuts only.
    // This named-cut cached decision deliberately conveys no cleanup grant.
    if (scope.edition === "default")
      await captureRetentionPlexProjection(tx, {
        decisionId: decision.id,
        groups: [current.association.group],
        bindings: [current.snapshot],
      });
  });
  return inventoryConsequences(f);
}

async function inventoryConsequences(f: Awaited<ReturnType<typeof fixture>>) {
  const db = h.database(),
    where = { mediaId: f.media.id, edition: f.input.scope.edition };
  return {
    watch: await db.plexWatchProjection.findMany({ where }),
    state: await db.watchState.findMany({ where }),
    decisions: await db.retentionDecision.findMany({
      where,
      include: { plexProjection: true },
    }),
  };
}

test("Media-owned movie publishes and finalizes with canonical storage while no legacy writer lease exists", async () => {
  const f = await fixture("default");
  onTestFinished(await grantTestManagedStorage(h.database()));
  await expect(
    publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).resolves.toEqual({ status: "available", reason: null });
  await finalizeMovieAcquisitionV4(
    f.network,
    f.input,
    testPlexBindingExecution(),
  );
  expect(await h.database().legacyWriterLease.count()).toBe(0);
});

test.each(["default", "extended_cut"] as const)(
  "normal inventory renews a real v4 %s movie through its schema2 parent and existing coordinator",
  async (edition) => {
    const { f, sibling } = await inventoryFixture(edition);
    await expect(
      publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
    ).resolves.toEqual({ status: "available", reason: null });
    await finalizeMovieAcquisitionV4(
      f.network,
      f.input,
      testPlexBindingExecution(),
    );
    const db = h.database();
    const before = await db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition } },
      include: { evidence: true },
    });
    const original = await inventoryPublicationHistory(f);
    const siblingConsequences =
      sibling === null ? null : await seedInventoryConsequences(sibling);
    if (sibling !== null) await seedInventoryConsequences(f);
    if (edition === "default") {
      const union = await readPlexGroupUnion(db, [f.media.id]);
      expect(union.oldGroups).toMatchObject([
        { assetId: f.asset.id, checksum: f.asset.checksum },
      ]);
      expect(union.newGroups).toEqual(union.oldGroups);
    }
    const literal = z
      .record(z.string(), z.json())
      .parse(before.evidence?.evidence);
    for (const invalid of [
      { ...literal, schemaVersion: 99 },
      { ...literal, item: null },
    ])
      expect(() =>
        parsePlexRecord(PlexAssociationSchema, invalid, identityHash(invalid)),
      ).toThrow();
    expect(() =>
      parsePlexRecord(PlexAssociationSchema, literal, "0".repeat(64)),
    ).toThrow("Plex immutable evidence hash changed");
    // Normal inventory has both configured sections; this fixture has no TV episodes.
    vi.spyOn(f.network.plex, "sections").mockResolvedValue([
      { key: "1", title: "Movies", type: "movie" },
      { key: "2", title: "TV", type: "show" },
    ]);
    const moviePage = f.network.plex.libraryPage.bind(f.network.plex);
    vi.spyOn(f.network.plex, "libraryPage").mockImplementation(
      (input, signal) =>
        input.sectionId === "2"
          ? Promise.resolve({ total: 0, items: [] })
          : moviePage(input, signal),
    );
    await db.plexIdentityMapping.update({
      where: { userId: original.request.userId },
      data: { verifiedAt: new Date(Date.now() - 301_000) },
    });
    f.item.Guid = [
      ...(f.item.Guid ?? []),
      { id: `plex://movie/inventory-${crypto.randomUUID()}` },
    ];
    const scanId = crypto.randomUUID();
    for (let page = 0; page < 10; page++) {
      const step = await sweepInventory(f.network, scanId);
      if (step.nextCursor === null) break;
    }
    expect(
      await db.reconciliationScan.findUniqueOrThrow({ where: { id: scanId } }),
    ).toMatchObject({ state: "completed" });
    const queued = await db.operation.findFirstOrThrow({
      where: { kind: "reverify_plex_binding", targetId: f.asset.id },
      include: { outbox: true },
    });
    const input = ReverifyPlexBindingInputSchema.parse(queued.payload);
    const request = await db.plexBindingVerificationRequest.findUniqueOrThrow({
      where: { operationId: queued.id },
    });
    const expected = PlexBindingExpectedSchema.parse(request.expected);
    expect(expected.parents).toMatchObject([
      {
        kind: "existing_movie_asset_v2",
        scope: f.input.scope,
        assetId: f.asset.id,
        physicalGrant: { kind: "movie_publication_transition_v2" },
      },
    ]);
    const started: unknown[] = [];
    await createOutboxActivities(db, async (value) => {
      started.push(value);
    }).dispatchMediaOutbox();
    expect(started).toContainEqual({
      workflowType: "reverifyPlexBindingWorkflow",
      workflowId: `media-operation-${queued.id}`,
      input,
    });
    const calls = f.calls.length;
    expect(
      await createPlexBindingActivities(f.network).reverify(
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: 1 });
    expect(
      f.calls
        .slice(calls)
        .filter((url) => url.pathname === "/library/sections/1/all").length,
    ).toBeGreaterThanOrEqual(2);
    const current = await readCurrentPlexBinding(db, {
      scope: { mediaId: f.media.id, edition },
      assetId: f.asset.id,
      access: {
        serverMachineId: "fixture-server",
        sectionId: "1",
        sectionType: "movie",
      },
    });
    expect(current).toMatchObject({
      status: "current",
      association: {
        schemaVersion: 2,
        scope: { mediaId: f.media.id, edition },
      },
    });
    const pointer = await db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition } },
    });
    expect(pointer.revision).toBe(before.revision + 1);
    expect(pointer.evidenceId).not.toBe(before.evidenceId);
    expect(
      await db.plexBindingVerificationReceipt.count({
        where: { operationId: queued.id },
      }),
    ).toBe(1);
    expect(await inventoryPublicationHistory(f)).toEqual(original);
    if (sibling !== null) {
      expect(await inventoryConsequences(sibling)).toEqual(siblingConsequences);
      const changed = await inventoryConsequences(f);
      expect(changed.watch).toEqual([]);
      expect(changed.state).toEqual([]);
      expect(changed.decisions).toMatchObject([
        { state: "cancelled", version: 1, plexProjection: null },
      ]);
    }
  },
);

test("movie inventory rejects changed scope, asset, version, reference and literal publication hash", async () => {
  const f = await fixture("default");
  await expect(
    publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).resolves.toEqual({ status: "available", reason: null });
  await finalizeMovieAcquisitionV4(
    f.network,
    f.input,
    testPlexBindingExecution(),
  );
  const db = h.database(),
    execution = testPlexBindingExecution();
  const expected = await captureExistingPlexBindingExpected(db, {
    assetIds: [f.asset.id],
    access: [
      {
        serverMachineId: "fixture-server",
        sectionId: "1",
        sectionType: "movie",
      },
    ],
  });
  const parent = expected.parents[0];
  if (parent?.kind !== "existing_movie_asset_v2")
    throw new Error("Actual movie inventory omitted its typed parent");
  const original = await inventoryPublicationHistory(f);
  const before = await db.plexBindingCurrent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  const freshness = plexBindingFreshness({ ...execution, guards: [execution] });
  const otherId = crypto.randomUUID();
  const invalid = [
    {
      ...parent,
      scope: { ...parent.scope, mediaId: otherId, rootMediaId: otherId },
    },
    { ...parent, assetId: otherId },
    { ...parent, assetVersion: parent.assetVersion + 1 },
    {
      ...parent,
      physicalGrant: {
        ...parent.physicalGrant,
        physicalEvidenceHash: "0".repeat(64),
      },
    },
  ];
  for (const changed of invalid)
    await expect(
      assertPlexBindingExpected(
        db,
        PlexBindingExpectedSchema.parse({ ...expected, parents: [changed] }),
        freshness,
        {
          access: expected.access,
          budget: new PublicationAuthorityReadBudget(),
        },
      ),
    ).rejects.toThrow();
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(100);
  await expect(
    assertPlexBindingExpected(db, expected, freshness, {
      access: expected.access,
      budget: exhausted,
    }),
  ).rejects.toThrow("100 total queried records");
  vi.spyOn(db.mediaPublicationTransition, "findUnique").mockResolvedValueOnce({
    ...original.publication,
    intentHash: "0".repeat(64),
  });
  await expect(
    assertPlexBindingExpected(db, expected, freshness, {
      access: expected.access,
      budget: new PublicationAuthorityReadBudget(),
    }),
  ).rejects.toThrow("Movie publication literal JSON hash changed");
  expect(
    await db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toEqual(before);
  expect(await inventoryPublicationHistory(f)).toEqual(original);
});

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
    const lease = await h.database().legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    try {
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
        reason:
          mode === "writer" ? "ownership_changed" : "verification_expired",
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
    } finally {
      if (mode === "writer")
        await h.database().legacyWriterLease.update({
          where: { id: lease.id },
          data: { expiresAt: lease.expiresAt },
        });
    }
  },
  30_000,
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
  const lease = await h.database().legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  try {
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
  } finally {
    await h.database().legacyWriterLease.update({
      where: { id: lease.id },
      data: { expiresAt: lease.expiresAt },
    });
  }
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
  const reservation = await h
    .database()
    .acquisitionReservation.findFirstOrThrow({
      where: { attemptId: f.input.attemptId },
    });
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
  expect(
    await h.database().acquisitionReservation.findFirstOrThrow({
      where: { attemptId: f.input.attemptId },
    }),
  ).toEqual(reservation);
});
