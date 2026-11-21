import { expect, test } from "vitest";
import { legacyClaimsHarness } from "#infrastructure/recovery/legacy-claims/test-fixture.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { PrismaPersonalMigration } from "./service.ts";
import { buildMovieRecoveryClaimsV3 } from "#infrastructure/recovery/legacy-claims/movie/projection.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";

const harness = legacyClaimsHarness();

async function fixture(status = 5, requesters: "mapped" | "mixed" = "mapped") {
  const f = await harness.setup();
  const record: MigrationRecord = {
    kind: "request",
    sourceId: "1",
    requesterSourceId: "7",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: f.movie.tmdbId ?? 1 },
    scope: "movie",
    seasons: [],
    sourceStatus: status,
    seasonStatuses: [],
    active: status === 2 || status === 5,
  };
  const capture = await new PrismaMigrationAdministration(f.db).upload(
    f.owner,
    {
      snapshot: captureFixture(
        "seerr",
        requesters === "mapped"
          ? [record]
          : [record, { ...record, sourceId: "2", requesterSourceId: "8" }],
      ),
    },
  );
  await f.bind(capture.captureId);
  const service = new PrismaPersonalMigration(f.db, {
    keepDays: 30,
    serverMachineId: "binding-fixture-server",
  });
  const selection = {
    captureIds: [capture.captureId],
    movieEditions: [{ mediaId: f.movie.id, edition: "default" as const }],
    historyOnly: [],
  };
  return { ...f, service, selection };
}

async function establishCurrentMovieTarget(
  f: Awaited<ReturnType<typeof fixture>>,
) {
  await f.db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(f.movie.id)], { createMissing: true }),
  );
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: defaultScope(f.movie.id) },
    }),
  ).toMatchObject({ editionRootId: f.movie.id });
}

async function holdCurrentLibrary(
  f: Awaited<ReturnType<typeof fixture>>,
  keep: boolean,
  reason: string,
) {
  await f.db.mediaIntent.upsert({
    where: { mediaId_edition: defaultScope(f.movie.id) },
    create: { mediaId: f.movie.id, libraryKeep: keep },
    update: { libraryKeep: keep },
  });
  await f.db.recoveryHold.create({
    data: { mediaId: f.movie.id, recoveryEpoch: 0, reason },
  });
}

async function importCurrentPersonalState(
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const preview = await f.service.preview(f.owner, f.selection);
  return f.service.apply(f.owner, crypto.randomUUID(), {
    ...f.selection,
    previewHash: preview.previewHash,
    acknowledgeExistingLibraryKeep: true,
    acknowledgeTemporaryFollowingClaims: true,
  });
}

function currentMovieRecoveryClaims(f: Awaited<ReturnType<typeof fixture>>) {
  return f.db.$transaction((tx) =>
    buildMovieRecoveryClaimsV3(
      tx,
      {
        scope: {
          mediaId: f.movie.id,
          rootMediaId: f.movie.id,
          edition: "default",
        },
        epoch: 0,
      },
      new PublicationAuthorityReadBudget(),
    ),
  );
}

test("independent Plex requester imports as Temporary/following without fabricated movie choice, watched state or transfer", async () => {
  const f = await fixture();
  const before = {
    torrents: await f.db.torrent.count(),
    attempts: await f.db.acquisitionAttempt.count(),
    watch: await f.db.watchState.count(),
  };
  const preview = await f.service.preview(f.owner, f.selection);
  expect(preview.blocked).toBe(false);
  const input = {
    ...f.selection,
    previewHash: preview.previewHash,
    acknowledgeExistingLibraryKeep: true as const,
    acknowledgeTemporaryFollowingClaims: true as const,
  };
  const key = crypto.randomUUID();
  const applied = await f.service.apply(f.owner, key, input);
  expect(applied).toMatchObject({
    status: "completed",
    version: 1,
    next: null,
  });
  expect(await f.service.apply(f.owner, key, input)).toEqual(applied);
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.subject.id,
        mediaId: f.movie.id,
        edition: "default",
      },
    },
  });
  expect(request).toMatchObject({
    active: true,
    keepingPolicy: "temporary",
    interestState: "following",
    movieEditionChoiceId: null,
    coverageCompletedAt: null,
  });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.movie.id, edition: "default" } },
    }),
  ).toMatchObject({ libraryKeep: false, libraryPolicyExplicit: false });
  expect(await f.service.imported(f.subject)).toContainEqual(
    expect.objectContaining({
      requestId: request.id,
      sourceKind: "seerr",
      sourceStatus: 5,
      sourceFulfilled: true,
      needsAcquisitionChoice: true,
    }),
  );
  expect({
    torrents: await f.db.torrent.count(),
    attempts: await f.db.acquisitionAttempt.count(),
    watch: await f.db.watchState.count(),
  }).toEqual(before);
  const outsider = await f.db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Other person" },
  });
  expect(await f.service.imported(outsider)).toEqual([]);
});

test("a changed binding identity or native state invalidates the exact preview before any claim write", async () => {
  const f = await fixture();
  const preview = await f.service.preview(f.owner, f.selection);
  await f.db.mediaItem.update({
    where: { id: f.movie.id },
    data: { version: { increment: 1 } },
  });
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), {
      ...f.selection,
      previewHash: preview.previewHash,
      acknowledgeExistingLibraryKeep: true,
      acknowledgeTemporaryFollowingClaims: true,
    }),
  ).rejects.toMatchObject({ code: "personal_migration_stale" });
  expect(
    await f.db.mediaRequest.count({ where: { mediaId: f.movie.id } }),
  ).toBe(0);
  await f.db.plexIdentityMapping.update({
    where: { userId: f.subject.id },
    data: { serverAccountId: "different-stable-account" },
  });
  const changed = await f.service.preview(f.owner, f.selection);
  expect(changed.claims[0]?.reason).toBe(
    "exact_plex_requester_binding_required",
  );
});

test("an exact reviewed Seerr selection imports only its own claim and keeps an omitted requester protected", async () => {
  const f = await fixture(5, "mixed");
  await establishCurrentMovieTarget(f);
  await holdCurrentLibrary(
    f,
    true,
    "migration_household_intent_review_required",
  );
  const full = await f.service.preview(f.owner, f.selection);
  expect(full.blocked).toBe(true);
  expect(full).not.toHaveProperty("selectedSeerrRequests");
  const matched = full.claims.find((claim) => claim.sourceId === "1");
  const unmapped = full.claims.find((claim) => claim.sourceId === "2");
  if (matched === undefined || unmapped === undefined)
    throw new Error("Fixture needs two captured Seerr requesters");
  expect(matched.disposition).toBe("import");
  expect(unmapped.reason).toBe("exact_plex_requester_binding_required");
  const approved = {
    captureId: matched.captureId,
    provenanceKey: matched.provenanceKey,
  };
  const blocked = {
    captureId: unmapped.captureId,
    provenanceKey: unmapped.provenanceKey,
  };
  const completeSelection = await f.service.preview(f.owner, {
    ...f.selection,
    selectedSeerrRequests: [approved, blocked],
  });
  expect(completeSelection.claims).toEqual(full.claims);
  expect(completeSelection.previewHash).not.toBe(full.previewHash);
  const acknowledgement = {
    acknowledgeExistingLibraryKeep: true as const,
    acknowledgeTemporaryFollowingClaims: true as const,
  };
  const key = crypto.randomUUID();
  await expect(
    f.service.apply(f.owner, key, {
      ...f.selection,
      ...acknowledgement,
      previewHash: full.previewHash,
    }),
  ).rejects.toMatchObject({ code: "personal_migration_blocked" });

  await expect(
    f.service.preview(f.owner, {
      ...f.selection,
      selectedSeerrRequests: [{ ...approved, provenanceKey: "a".repeat(64) }],
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  await expect(
    f.service.preview(f.owner, {
      ...f.selection,
      selectedSeerrRequests: [approved, approved],
    }),
  ).rejects.toThrow("Select each exact Seerr request only once");
  await expect(
    f.service.preview(f.owner, {
      ...f.selection,
      historyOnly: [blocked.provenanceKey],
      selectedSeerrRequests: [approved],
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });

  const selectedInput = { ...f.selection, selectedSeerrRequests: [approved] };
  const selected = await f.service.preview(f.owner, selectedInput);
  expect(selected).toMatchObject({
    selectedSeerrRequests: [approved],
    blocked: false,
    claims: [matched],
    captures: full.captures,
  });
  const blockedInput = { ...f.selection, selectedSeerrRequests: [blocked] };
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), {
      ...blockedInput,
      ...acknowledgement,
      previewHash: selected.previewHash,
    }),
  ).rejects.toMatchObject({ code: "personal_migration_stale" });
  const blockedPreview = await f.service.preview(f.owner, blockedInput);
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), {
      ...blockedInput,
      ...acknowledgement,
      previewHash: blockedPreview.previewHash,
    }),
  ).rejects.toMatchObject({ code: "personal_migration_blocked" });

  const input = {
    ...selectedInput,
    ...acknowledgement,
    previewHash: selected.previewHash,
  };
  const selectedKey = crypto.randomUUID();
  const applied = await f.service.apply(f.owner, selectedKey, input);
  expect(await f.service.apply(f.owner, selectedKey, input)).toEqual(applied);
  const receipt = await f.db.applicationEvent.findUniqueOrThrow({
    where: { id: applied.eventId },
  });
  const stored = await f.db.migrationRecord.findMany({
    where: { captureId: approved.captureId, kind: "request" },
  });
  expect(stored.map((record) => record.provenanceKey).sort()).toEqual(
    [approved.provenanceKey, blocked.provenanceKey].sort(),
  );
  expect(receipt.payload).toMatchObject({
    captures: full.captures,
    claims: [matched],
    sourceRecords: [
      {
        ...approved,
        observationHash: stored.find(
          (record) => record.provenanceKey === approved.provenanceKey,
        )?.observationHash,
      },
    ],
    imports: [{ ...approved, userId: f.subject.id }],
  });
  expect(
    await f.db.mediaRequest.findMany({
      where: { mediaId: f.movie.id },
      select: { userId: true, active: true },
    }),
  ).toEqual([{ userId: f.subject.id, active: true }]);
  const hold = await f.db.recoveryHold.findUniqueOrThrow({
    where: { mediaId_edition: defaultScope(f.movie.id) },
  });
  expect(hold.releasedAt).toBeNull();
});

test("declined source requests remain visible history and never create active native interest", async () => {
  const f = await fixture(3);
  const preview = await f.service.preview(f.owner, f.selection);
  expect(preview.claims[0]?.disposition).toBe("history");
  await f.service.apply(f.owner, crypto.randomUUID(), {
    ...f.selection,
    previewHash: preview.previewHash,
    acknowledgeExistingLibraryKeep: true,
    acknowledgeTemporaryFollowingClaims: true,
  });
  expect(
    await f.db.mediaRequest.count({ where: { mediaId: f.movie.id } }),
  ).toBe(0);
  expect(await f.db.mediaIntent.count({ where: { mediaId: f.movie.id } })).toBe(
    0,
  );
});

test.each(["migration_household_intent_review_required", "manual_owner_hold"])(
  "only the generated household hold releases after real source accounting (%s)",
  async (reason) => {
    const f = await fixture();
    await establishCurrentMovieTarget(f);
    await holdCurrentLibrary(f, true, reason);
    await importCurrentPersonalState(f);
    const hold = await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.movie.id, edition: "default" } },
    });
    expect(hold.releasedAt !== null).toBe(
      reason === "migration_household_intent_review_required",
    );
    const projected = await currentMovieRecoveryClaims(f);
    expect(projected.claims).toEqual([]);
    expect(projected.blockers).toEqual([]);
    expect(await f.db.recoveryReleaseReceipt.count()).toBe(0);
    const event = await f.db.applicationEvent.findFirstOrThrow({
      where: { kind: "personal_state_imported" },
    });
    await expect(
      f.db.applicationEvent.update({
        where: { id: event.id },
        data: { payload: {} },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      f.db.applicationEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow("immutable");
  },
);

test("an additional unaccounted captured approval retains the generated hold", async () => {
  const f = await fixture();
  await establishCurrentMovieTarget(f);
  await f.capture({ requesterSourceId: "unmapped-old-account" });
  await holdCurrentLibrary(
    f,
    true,
    "migration_household_intent_review_required",
  );
  await importCurrentPersonalState(f);
  const hold = await f.db.recoveryHold.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.movie.id, edition: "default" } },
  });
  expect(hold.releasedAt).toBeNull();
});

test("wrong native source lineage cannot account a captured approval", async () => {
  const f = await fixture();
  await importCurrentPersonalState(f);
  const request = await f.db.mediaRequest.findFirstOrThrow({
    where: { mediaId: f.movie.id },
  });
  // Simulate a broken producer after the immutable receipt: a different native
  // subject cannot inherit another person's captured interest.
  await f.db.mediaRequest.update({
    where: { id: request.id },
    data: { userId: f.owner.id, version: { increment: 1 } },
  });
  const projected = await currentMovieRecoveryClaims(f);
  expect(projected.claims).toHaveLength(1);
});

test("an incomplete import without established library Keep cannot release the generated hold", async () => {
  const f = await fixture();
  await establishCurrentMovieTarget(f);
  await holdCurrentLibrary(
    f,
    false,
    "migration_household_intent_review_required",
  );
  await importCurrentPersonalState(f);
  const hold = await f.db.recoveryHold.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.movie.id, edition: "default" } },
  });
  expect(hold.releasedAt).toBeNull();
});

test("an unclassified historical movie target requires genuine lineage review before source claims can activate", async () => {
  const f = await fixture();
  const importsBefore = await f.db.applicationEvent.count({
    where: { kind: "personal_state_imported" },
  });
  const target = await f.db.mediaIntent.create({
    data: { mediaId: f.movie.id, libraryKeep: true },
  });
  expect(target.editionRootId).toBeNull();
  const hold = await f.db.recoveryHold.create({
    data: {
      mediaId: f.movie.id,
      recoveryEpoch: 0,
      reason: "migration_household_intent_review_required",
    },
  });
  const preview = await f.service.preview(f.owner, f.selection);
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), {
      ...f.selection,
      previewHash: preview.previewHash,
      acknowledgeExistingLibraryKeep: true,
      acknowledgeTemporaryFollowingClaims: true,
    }),
  ).rejects.toMatchObject({ code: "lineage_unresolved" });
  expect(
    await f.db.mediaRequest.count({ where: { mediaId: f.movie.id } }),
  ).toBe(0);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: defaultScope(f.movie.id) },
    }),
  ).toEqual(target);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId_edition: defaultScope(f.movie.id) },
    }),
  ).toEqual(hold);
  expect(
    await f.db.applicationEvent.count({
      where: { kind: "personal_state_imported" },
    }),
  ).toBe(importsBefore);
});
