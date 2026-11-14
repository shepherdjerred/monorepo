import { afterAll, beforeAll, expect, test } from "vitest";
import { lstat, readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { applyPreparedHandoff } from "#automation/handoff/apply.ts";
import {
  PrepareLibraryHandoffV3Schema,
  LibraryHandoffScopeV3Schema,
} from "#shared/handoff/library-v3.ts";
import { ExternalLibraryRegistrationSchema } from "#shared/external-library/contract.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import {
  PassiveRegistrationApprovalSchema,
  type PassiveRegistrationApproval,
} from "#shared/handoff/passive-registration.ts";
import { snapshotHash, canonicalJson } from "#migration/profile-import.ts";
import { loadMovieLibraryParentV2 } from "#infrastructure/movie-editions/library-records.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { previewPassiveRegistrations } from "./passive-preview.ts";
import { adoptLibraryTargets } from "#automation/handoff/library-adopt.ts";
import { LibraryHandoffNetworkProtocolSchema } from "#shared/handoff/protocol.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let bytes: Uint8Array;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  bytes = await movieVideoFixture();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture(edition: MovieEditionKey) {
  const db = cluster.database;
  let approval: PassiveRegistrationApproval | undefined;
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  const f = await handoffFixture(db, {
    initialEdition: edition,
    bytes,
    fileName: `Synthetic Film (2020)${edition === "default" ? "" : ` {edition-${label}}`}.mkv`,
    async extendReport({ report, target }) {
      const entry = report.entries.find((item) => item.kind === "file");
      const mediaId = z.uuid().parse(entry?.mediaIds[0]);
      const root = await db.mediaItem.findUniqueOrThrow({
        where: { id: mediaId },
      });
      const actor = await db.mediaUser.findFirstOrThrow({
        where: { role: "owner" },
        include: { plexIdentity: true },
        orderBy: { createdAt: "desc" },
      });
      const eventId = crypto.randomUUID();
      const registration = ExternalLibraryRegistrationSchema.parse({
        schemaVersion: 1,
        source: "plex",
        registrationEventId: eventId,
        registeredAt: new Date().toISOString(),
        serverMachineId: actor.plexIdentity?.serverMachineId,
        sectionId: "1",
        sectionType: "movie",
        rootMediaId: mediaId,
        rootTmdbId: root.tmdbId,
        rootYear: root.year,
        rootCatalogIdentityHash: snapshotHash({
          id: root.id,
          tmdbId: root.tmdbId,
        }),
        edition: "default",
        observedEditionTitle: label,
        canonicalEdition: null,
        editionConfidence: "unknown",
        canonicalPath: target,
        sizeBytes: String(bytes.byteLength),
        members: [
          {
            mediaId,
            ratingKey: "123",
            partId: "1",
            guids: [`tmdb://${String(root.tmdbId)}`],
            seasonNumber: null,
            episodeNumber: null,
          },
        ],
      });
      const registrationHash = snapshotHash(registration);
      await db.applicationEvent.create({
        data: {
          id: eventId,
          actorId: actor.id,
          mediaId,
          kind: "external_library_registered",
          payload: { registration, registrationHash },
        },
      });
      const asset = await db.libraryAsset.create({
        data: {
          path: target,
          sizeBytes: BigInt(bytes.byteLength),
          state: "published",
          owned: false,
          ownershipEpoch: -1,
          edition: "default",
          editionRootId: mediaId,
          properties: { externalLibrary: registration },
          coverage: { create: [{ mediaId, current: true }] },
        },
      });
      approval = PassiveRegistrationApprovalSchema.parse({
        provenanceKey: entry?.provenanceKey,
        assetId: asset.id,
        expectedVersion: 0,
        registrationEventId: eventId,
        registrationHash,
        registrationRaw: canonicalJson(registration),
      });
    },
    prepareRequest({ request, report }) {
      if (approval === undefined)
        throw new Error("Missing exact passive registration fixture");
      const files = report.entries.filter((entry) => entry.kind === "file");
      return PrepareLibraryHandoffV3Schema.parse({
        ...request,
        schemaVersion: 3,
        purpose: "migration",
        plexEditionLabels: "update_in_place",
        selected: files.map((entry) => ({
          provenanceKey: entry.provenanceKey,
          evidenceHash: entry.observationHash,
        })),
        registeredAssets: [approval],
        movies: files.map((entry) => ({
          provenanceKey: entry.provenanceKey,
          edition,
          resolution: {
            kind: "owner_review",
            reason:
              "Exact existing file and already-corrected Plex label reviewed",
          },
        })),
      });
    },
  });
  directories.push(f.directory);
  f.context.files.inspect = inspectMedia;
  const original = await f.network.context.plex.metadata("fixture");
  const item = {
    ...original,
    ratingKey: "123",
    type: "movie" as const,
    editionTitle: label,
    viewCount: 3,
    lastViewedAt: 1234,
    viewOffset: 45_000,
  };
  f.network.context.plex.libraryPage = () =>
    Promise.resolve({ total: 1, items: [item] });
  f.network.context.plex.metadata = () => Promise.resolve(item);
  f.network.context.plex.metadataForEditionEdit = () => Promise.resolve(item);
  return { ...f, item };
}

test.each(["default", "directors_cut"] as const)(
  "passive %s registration becomes a genuine managed parent once without moving bytes or changing watch history",
  async (edition) => {
    const f = await fixture(edition);
    const before = await lstat(f.target, { bigint: true });
    const requests = await cluster.database.mediaRequest.count();
    const attempts = await cluster.database.acquisitionAttempt.count();
    const torrents = await cluster.database.torrent.count();
    const ready = await f.ready();
    const preparedScope = LibraryHandoffScopeV3Schema.parse(
      ready.prepared.scope,
    );
    const approvals = await cluster.database.$transaction((tx) =>
      previewPassiveRegistrations(tx, {
        bundleReviewId: preparedScope.request.bundleReviewId,
        bundleReviewVersion: preparedScope.request.bundleReviewVersion,
        selected: preparedScope.files.map((file) => file.provenanceKey),
      }),
    );
    expect(approvals).toEqual(preparedScope.request.registeredAssets);
    const receiptId = await applyPreparedHandoff(
      f.context,
      ready.input,
      ready.prepared,
    );
    expect(
      await applyPreparedHandoff(f.context, ready.input, ready.prepared),
    ).toBe(receiptId);
    const asset = await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { path: f.target },
      include: { coverage: true },
    });
    expect(asset).toMatchObject({
      edition,
      version: 1,
      owned: true,
      ownershipEpoch: 0,
      torrentId: null,
      editionRootId: f.network.media.id,
    });
    expect(asset.coverage).toMatchObject([
      { edition, current: true, mediaId: f.network.media.id },
    ]);
    expect(await readFile(f.target)).toEqual(Buffer.from(bytes));
    const after = await lstat(f.target, { bigint: true });
    expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
    expect(f.item).toMatchObject({
      viewCount: 3,
      lastViewedAt: 1234,
      viewOffset: 45_000,
      editionTitle: MOVIE_EDITION_REGISTRY[edition].plexLabel,
    });
    expect(await cluster.database.mediaRequest.count()).toBe(requests);
    expect(await cluster.database.acquisitionAttempt.count()).toBe(attempts);
    expect(await cluster.database.torrent.count()).toBe(torrents);
    const parent = await loadMovieLibraryParentV2(
      cluster.database,
      { receiptId, assetId: asset.id },
      new PublicationAuthorityReadBudget(),
    );
    expect(parent.asset.version).toBe(1);
    expect(
      await cluster.database.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.network.media.id, edition } },
      }),
    ).toMatchObject({ libraryKeep: true });
    const scope = z
      .record(z.string(), z.json())
      .parse(LibraryHandoffScopeV3Schema.parse(ready.prepared.scope));
    const plan = await cluster.database.mediaHandoffPlan.findUniqueOrThrow({
      where: { id: f.planId },
    });
    const network = z
      .object({ network: z.record(z.string(), z.json()) })
      .parse(plan.plan).network;
    expect(await acceptedParent(scope, asset.id, 1, network)).toBe(true);
    for (const corrupt of corruptedScopes(scope))
      expect(await acceptedParent(corrupt, asset.id, 1, network)).toBe(false);
    expect(
      await acceptedParent(scope, asset.id, 1, {
        ...network,
        registeredPlexServerMachineId: "a-different-server",
      }),
    ).toBe(false);
  },
);

test("metadata-only monitored titles without physical library coverage do not gain library Keep", async () => {
  const f = await fixture("default");
  const ready = await f.ready();
  const scope = LibraryHandoffScopeV3Schema.parse(ready.prepared.scope);
  const original = scope.media[0];
  if (original === undefined) throw new Error("Missing fixture target");
  const absent = await cluster.database.mediaItem.create({
    data: { kind: "movie", title: "Unfulfilled manager title" },
  });
  const observation =
    await cluster.database.mediaHandoffObservation.findFirstOrThrow({
      where: { planId: f.planId, kind: "network" },
      orderBy: { observedAt: "desc" },
    });
  const network = LibraryHandoffNetworkProtocolSchema.parse(
    observation.evidence,
  );
  await cluster.database.$transaction((tx) =>
    adoptLibraryTargets(tx, {
      planId: f.planId,
      scope: {
        ...scope,
        files: [],
        media: [{ ...original, mediaId: absent.id }],
        targets: [
          {
            mediaId: absent.id,
            edition: "default",
            generation: null,
            version: null,
          },
        ],
      },
      network: { ...network, plex: [] },
    }),
  );
  expect(
    await cluster.database.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: absent.id, edition: "default" } },
    }),
  ).toMatchObject({ libraryKeep: false });
});

async function acceptedParent(
  scope: unknown,
  assetId: string,
  version: number,
  network: unknown,
) {
  const rows = z
    .array(z.object({ accepted: z.boolean() }))
    .length(1)
    .parse(
      await cluster.database.$queryRaw`
    SELECT media_library_initial_owner_version(${JSON.stringify(z.json().parse(scope))}::jsonb,${assetId},${version},${JSON.stringify(z.json().parse(network))}::jsonb) AS accepted
  `,
    );
  return rows[0]?.accepted;
}

function corruptedScopes(
  scope: Record<string, z.infer<ReturnType<typeof z.json>>>,
) {
  const values = [];
  const request = z.record(z.string(), z.json()).parse(scope["request"]);
  const files = z.array(z.record(z.string(), z.json())).parse(scope["files"]);
  const file = files[0];
  const approvals = z
    .array(z.record(z.string(), z.json()))
    .parse(request["registeredAssets"]);
  const approval = approvals[0];
  if (file === undefined || approval === undefined)
    throw new Error("Missing passive scope fixture");
  for (const schemaVersion of [null, 2]) {
    values.push({ ...scope, schemaVersion });
    values.push({ ...scope, request: { ...request, schemaVersion } });
  }
  values.push(
    Object.fromEntries(
      Object.entries(scope).filter(([key]) => key !== "schemaVersion"),
    ),
  );
  values.push({
    ...scope,
    request: Object.fromEntries(
      Object.entries(request).filter(([key]) => key !== "schemaVersion"),
    ),
  });
  for (const change of [
    { registrationEventId: crypto.randomUUID() },
    { registrationHash: "f".repeat(64) },
    { registrationRaw: "{}" },
    { expectedVersion: 1 },
    { assetId: crypto.randomUUID() },
    { provenanceKey: "f".repeat(64) },
  ])
    values.push({
      ...scope,
      request: { ...request, registeredAssets: [{ ...approval, ...change }] },
    });
  for (const change of [
    { canonicalPath: "/movies/substituted.mkv" },
    { existingAssetVersion: 1 },
    { existingAssetId: crypto.randomUUID() },
    { mediaIds: [crypto.randomUUID()] },
    { assetId: crypto.randomUUID() },
  ])
    values.push({ ...scope, files: [{ ...file, ...change }] });
  values.push({ ...scope, request: { ...request, registeredAssets: [] } });
  values.push({
    ...scope,
    request: {
      ...request,
      registeredAssets: [
        approval,
        {
          ...approval,
          assetId: crypto.randomUUID(),
          provenanceKey: "e".repeat(64),
        },
      ],
    },
  });
  return values;
}
