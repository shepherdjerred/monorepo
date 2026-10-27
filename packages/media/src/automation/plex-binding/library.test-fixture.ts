import path from "node:path";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { handoffFixture } from "#automation/handoff/test-fixture.ts";
import { applyPreparedHandoff } from "#automation/handoff/apply.ts";
import { prepareHandoffFiles } from "#automation/handoff/files.ts";
import { finishHandoffPreparation } from "#automation/handoff/plan.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { PrismaMigrationBundles } from "#migration/bundle-persistence.ts";
import { createHandoffNetworkProducer } from "#migration/handoff-network/producer.ts";
import {
  captureFixture,
  mediaFixture,
} from "#migration/bundle-test-fixtures.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { PrepareLibraryHandoffV2Schema } from "#shared/handoff-v2.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { createAutomationTestContext } from "#testing/automation.ts";
import { PlexClient, type PlexEditionItem } from "#integrations/plex.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";

type SourceMedia = Extract<MigrationRecord, { kind: "media" }>;
type Base = Awaited<ReturnType<typeof handoffFixture>>;

/** Actual capture/report/approval and Files adoption; external Plex, probes and mount attestations are synthetic. */
export async function libraryBindingFixture(
  db: Database,
  edition: MovieEditionKey,
  directoryCreated: (directory: string) => void,
  options: { bytes?: Uint8Array } = {},
) {
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  const f = await handoffFixture(db, {
    ...options,
    initialEdition: edition,
    fileName: `Synthetic Film${edition === "default" ? "" : ` {edition-${label}}`}.mkv`,
  });
  directoryCreated(f.directory);
  if (options.bytes !== undefined) f.context.files.inspect = inspectMedia;
  f.context.files.pathMapping = {
    canonical(kind, root, relative) {
      return root === "control"
        ? path.join(`/data/${kind}/.media-control`, relative)
        : path.join(f.context.files.roots[kind][root], relative);
    },
    local(stored) {
      for (const kind of ["movies", "tv"] as const) {
        const prefix = `/data/${kind}/.media-control/`;
        if (stored.startsWith(prefix))
          return path.join(
            f.context.files.roots[kind].control,
            stored.slice(prefix.length),
          );
      }
      return stored;
    },
  };
  const source = await adoptLibraryBindingSource(f, {
    kind: "movies",
    edition,
    media: [
      mediaFixture("1", "movie", {
        tmdb: z.number().parse(f.network.media.tmdbId),
      }),
    ],
  });
  return movieLibraryWire(f, source, edition);
}

export async function adoptLibraryBindingSource(
  f: Base,
  options: {
    kind: "movies" | "tv";
    edition: MovieEditionKey;
    media: SourceMedia[];
    qualitySourceId?: string;
  },
) {
  const db = f.context.files.db;
  const administration = new PrismaMigrationAdministration(db);
  const bundles = new PrismaMigrationBundles(db);
  const storedProfile = await db.qualityProfile.findUniqueOrThrow({
    where: { id: f.profile.id },
  });
  const profile = QualityRulesSchema.parse(storedProfile.rules).resolved;
  if (profile === undefined)
    throw new Error("Expected imported fixture profile");
  const media = structuredClone(options.media);
  for (const root of media.filter((item) => item.parentSourceId === null))
    root.profileSourceId = String(profile.profile.id);
  const sourcePath = `/${options.kind}/${path.basename(f.target)}`;
  const records: MigrationRecord[] = [
    ...media,
    {
      kind: "file",
      sourceId: "file1",
      mediaSourceIds: media
        .filter(
          (item) => item.mediaKind === "movie" || item.mediaKind === "episode",
        )
        .map((item) => item.sourceId),
      path: sourcePath,
      sizeBytes: Buffer.byteLength(f.bytes),
      checksum: null,
      downloadHash: null,
      qualitySourceId: options.qualitySourceId ?? "3",
    },
  ];
  const uploaded = await administration.upload(f.network.actor, {
    snapshot: captureFixture(
      "radarr",
      options.kind === "movies" ? records : [],
    ),
  });
  const empty = await administration.upload(f.network.actor, {
    snapshot: captureFixture("sonarr", options.kind === "tv" ? records : []),
  });
  const movieCaptureId = z.uuid().parse(uploaded.captureId);
  const tvCaptureId = z.uuid().parse(empty.captureId);
  const captureId = options.kind === "movies" ? movieCaptureId : tvCaptureId;
  const review = await bundles.create(f.network.actor, {
    schemaVersion: 2,
    purpose: "initial_library",
    captureIds: [movieCaptureId, tvCaptureId],
    rootMappings: [
      {
        captureId: movieCaptureId,
        sourceRoot: "/movies",
        canonicalRoot: f.context.files.roots.movies.library,
        verified: false,
      },
      {
        captureId: tvCaptureId,
        sourceRoot: "/tv",
        canonicalRoot: f.context.files.roots.tv.library,
        verified: false,
      },
    ],
  });
  const file = review.report.entries.find((entry) => entry.kind === "file");
  if (file === undefined) throw new Error("Expected actual normalized file");
  await bundles.review(f.network.actor, crypto.randomUUID(), review.id, {
    expectedVersion: review.version,
    reportHash: review.report.reportHash,
    bundleHash: review.manifest.bundleHash,
    recoveryEpoch: 0,
    runtimeVersion: 0,
    action: "approve",
    acknowledgeNoOwnershipTransfer: true,
    selected: review.report.entries
      .filter((entry) => entry.kind === "media")
      .map((entry) => ({
        provenanceKey: entry.provenanceKey,
        evidenceHash: entry.observationHash,
      })),
  });
  const request = PrepareLibraryHandoffV2Schema.parse({
    ...f.request,
    schemaVersion: 2,
    purpose: "migration",
    bundleReviewId: review.id,
    bundleReviewVersion: review.version + 1,
    bundleHash: review.manifest.bundleHash,
    reportHash: review.report.reportHash,
    selected: [
      { provenanceKey: file.provenanceKey, evidenceHash: file.observationHash },
    ],
    profiles: [
      {
        captureId,
        sourceProfileId: String(profile.profile.id),
        profileId: f.profile.id,
        version: 0,
        snapshotHash: profile.snapshotHash,
      },
    ],
    movies:
      options.kind === "movies"
        ? [
            {
              provenanceKey: file.provenanceKey,
              edition: options.edition,
              resolution: { kind: "conventional" },
            },
          ]
        : [],
    subtitlePolicies: [],
  });
  const preparing = await f.commands.prepare(
    f.network.actor,
    crypto.randomUUID(),
    request,
  );
  const planId = z.uuid().parse(preparing.handoffId);
  const observe = createHandoffNetworkProducer(f.network.context);
  await observe(planId);
  await finishHandoffPreparation(
    db,
    planId,
    await prepareHandoffFiles(f.context, planId),
  );
  const detail = await f.commands.detail(f.network.actor, planId);
  const applied = await f.commands.apply(
    f.network.actor,
    crypto.randomUUID(),
    planId,
    {
      schemaVersion: 2,
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: 0,
      runtimeVersion: 0,
      acknowledgeRecoveryHolds: true,
    },
  );
  await observe(planId);
  const receiptId = await applyPreparedHandoff(
    f.context,
    { planId, operationId: z.uuid().parse(applied.operationId) },
    await prepareHandoffFiles(f.context, planId),
  );
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { path: f.target },
  });
  return { asset, receiptId, reviewId: review.id };
}

async function movieLibraryWire(
  f: Base,
  source: Awaited<ReturnType<typeof adoptLibraryBindingSource>>,
  edition: MovieEditionKey,
) {
  const db = f.context.files.db;
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  const itemId = String(1000 + (await db.libraryAsset.count()));
  let item: PlexEditionItem = {
    ratingKey: itemId,
    type: "movie",
    title: f.network.media.title,
    ...(edition === "default" ? {} : { editionTitle: label }),
    Guid: [{ id: `tmdb://${String(f.network.media.tmdbId)}` }],
    Media: [
      {
        Part: [
          {
            id: Number(itemId),
            file: f.target,
            size: Buffer.byteLength(f.bytes),
          },
        ],
      },
    ],
    viewCount: 3,
    lastViewedAt: 1_234_567,
    viewOffset: 456_000,
  };
  const calls: string[] = [];
  const context = createAutomationTestContext(db, f.network.context.cipher);
  context.plex = new PlexClient(
    {
      baseUrl: "http://plex.fixture",
      token: "synthetic",
      clientIdentifier: "synthetic",
    },
    (url) => {
      calls.push(url.pathname);
      if (url.pathname === "/identity")
        return Promise.resolve(
          Response.json({
            MediaContainer: { machineIdentifier: "fixture-server" },
          }),
        );
      if (url.pathname === "/library/sections")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 1,
              Directory: [{ key: "1", type: "movie", title: "Movies" }],
            },
          }),
        );
      if (url.pathname === "/library/sections/1/all")
        return Promise.resolve(
          Response.json({
            MediaContainer: { size: 1, totalSize: 1, Metadata: [item] },
          }),
        );
      return url.pathname === `/library/metadata/${itemId}`
        ? Promise.resolve(
            Response.json({ MediaContainer: { size: 1, Metadata: [item] } }),
          )
        : Promise.reject(
            new Error(`Unexpected library fixture request ${url.pathname}`),
          );
    },
  );
  return {
    ...f,
    files: f.context.files,
    context,
    ...source,
    calls,
    item: () => item,
    setItem: (value: PlexEditionItem) => {
      item = value;
    },
  };
}
