import path from "node:path";
import {
  storedWorkerPath,
  storedFilePath,
} from "#automation/files/paths/locations.ts";
import { writeFile } from "node:fs/promises";
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
import { PrepareLibraryHandoffV3Schema } from "#shared/handoff/library-v3.ts";
import {
  uploadHouseholdCaptions,
  householdCaptionSelection,
} from "./library-fixture/household-captions.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { configureMovieLibraryPaths } from "./library-fixture/movie-paths.ts";
import type { InitialMovieSidecar } from "./library-fixture/movie-sidecars.ts";
import { uploadLibraryFixtureSidecarsV1 } from "./library-fixture/tv-sidecars.ts";

type SourceMedia = Extract<MigrationRecord, { kind: "media" }>;
type Base = Awaited<ReturnType<typeof handoffFixture>>;

/** Actual capture/report/approval and Files adoption; external Plex, probes and mount attestations are synthetic. */
export async function libraryBindingFixture(
  db: Database,
  edition: MovieEditionKey,
  directoryCreated: (directory: string) => void,
  options: {
    bytes?: Uint8Array;
    initialSidecars?: { language: string; bytes: Uint8Array }[];
    memberAccountId?: string;
    actualMovieExclusion?: boolean;
    canonicalStorage?: boolean;
    householdCaptions?: boolean;
    monitored?: boolean;
    movieMetadata?: {
      year: number;
      runtimeMinutes: number;
      originalLanguage: string;
    };
  } = {},
) {
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  const f = await handoffFixture(db, {
    ...options,
    initialEdition: edition,
    fileName: `Synthetic Film${edition === "default" ? "" : ` {edition-${label}}`}.mkv`,
  });
  directoryCreated(f.directory);
  if (options.bytes !== undefined) f.context.files.inspect = inspectMedia;
  await configureMovieLibraryPaths(f, options);
  const sidecars: InitialMovieSidecar[] | undefined =
    options.initialSidecars === undefined ? undefined : [];
  for (const sidecar of options.initialSidecars ?? []) {
    const filename = subtitleDestination({
      videoPath: f.target,
      language: sidecar.language,
      forced: false,
      hearingImpaired: false,
      format: "srt",
    });
    await writeFile(filename, sidecar.bytes);
    sidecars?.push({
      language: sidecar.language,
      path: `/movies/${path.basename(filename)}`,
      videoPath: `/movies/${path.basename(f.target)}`,
      mediaSourceId: "1",
    });
  }
  const source = await adoptLibraryBindingSource(f, {
    kind: "movies",
    edition,
    media: [
      {
        ...mediaFixture("1", "movie", {
          tmdb: z.number().parse(f.network.media.tmdbId),
        }),
        ...(options.monitored === undefined
          ? {}
          : { monitored: options.monitored }),
      },
    ],
    ...(sidecars === undefined ? {} : { initialSidecars: sidecars }),
    ...(options.householdCaptions === undefined
      ? {}
      : { householdCaptions: options.householdCaptions }),
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
    targetPath?: string;
    /** Every selected file is a real physical asset, adopted by this ONE approval. */
    files?: {
      sourceId: string;
      targetPath: string;
      mediaSourceIds: string[];
      sizeBytes: number;
    }[];
    householdCaptions?: boolean;
    initialSidecars?: InitialMovieSidecar[];
    monitorSeries?: { seriesId: string; includeSpecials: boolean };
  },
) {
  const db = f.context.files.db;
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const activation =
    z.enum(["observe", "active"]).parse(runtime.mode) === "observe"
      ? "activate"
      : "extend";
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
  const targetPath =
    options.targetPath ??
    storedWorkerPath(f.context.files, options.kind, f.target);
  const files = options.files ?? [
    {
      sourceId: "file1",
      targetPath,
      mediaSourceIds: media
        .filter(
          (item) => item.mediaKind === "movie" || item.mediaKind === "episode",
        )
        .map((item) => item.sourceId),
      sizeBytes: Buffer.byteLength(f.bytes),
    },
  ];
  const records: MigrationRecord[] = [
    ...media,
    ...files.map(
      (file) =>
        ({
          kind: "file",
          sourceId: file.sourceId,
          mediaSourceIds: file.mediaSourceIds,
          path: `/${options.kind}/${path.basename(file.targetPath)}`,
          sizeBytes: file.sizeBytes,
          checksum: null,
          downloadHash: null,
          qualitySourceId: options.qualitySourceId ?? "3",
        }) as const,
    ),
  ];
  const tvSnapshot = captureFixture(
    "sonarr",
    options.kind === "tv" ? records : [],
  );
  const movieSnapshot = captureFixture(
    "radarr",
    options.kind === "movies" ? records : [],
  );
  const uploaded = await administration.upload(f.network.actor, {
    snapshot: movieSnapshot,
  });
  const empty = await administration.upload(f.network.actor, {
    snapshot: tvSnapshot,
  });
  const movieCaptureId = z.uuid().parse(uploaded.captureId);
  const tvCaptureId = z.uuid().parse(empty.captureId);
  const captureId = options.kind === "movies" ? movieCaptureId : tvCaptureId;
  const captionCapture = await uploadHouseholdCaptions({
    administration,
    actor: f.network.actor,
    enabled: options.householdCaptions === true,
    kind: options.kind,
    media,
    sourceInstanceId: { movies: movieSnapshot, tv: tvSnapshot }[options.kind]
      .sourceInstanceId,
  });
  const sidecarCapture = await uploadLibraryFixtureSidecarsV1({
    administration,
    actor: f.network.actor,
    kind: options.kind,
    movieInstanceId: movieSnapshot.sourceInstanceId,
    tvInstanceId: tvSnapshot.sourceInstanceId,
    sidecars: options.initialSidecars,
  });
  const review = await bundles.create(f.network.actor, {
    schemaVersion: 2,
    purpose: "initial_library",
    captureIds: [
      movieCaptureId,
      tvCaptureId,
      ...(captionCapture === undefined
        ? []
        : [z.uuid().parse(captionCapture.captureId)]),
      ...(sidecarCapture === undefined
        ? []
        : [z.uuid().parse(sidecarCapture.captureId)]),
    ],
    rootMappings: [
      {
        captureId: movieCaptureId,
        sourceRoot: "/movies",
        canonicalRoot: storedFilePath(f.context.files, "movies", "library", ""),
        verified: false,
      },
      {
        captureId: tvCaptureId,
        sourceRoot: "/tv",
        canonicalRoot: storedFilePath(f.context.files, "tv", "library", ""),
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
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
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
    activation,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    bundleReviewId: review.id,
    bundleReviewVersion: review.version + 1,
    bundleHash: review.manifest.bundleHash,
    reportHash: review.report.reportHash,
    selected: [
      ...review.report.entries
        .filter(
          (entry) =>
            entry.kind === "file" ||
            (options.initialSidecars !== undefined &&
              entry.kind === "subtitle") ||
            (options.householdCaptions === true &&
              entry.kind === "subtitle_preference"),
        )
        .map((entry) => ({
          provenanceKey: entry.provenanceKey,
          evidenceHash: entry.observationHash,
        })),
      ...review.report.entries
        .filter(
          (entry) =>
            options.monitorSeries !== undefined &&
            entry.sourceRecord.kind === "media" &&
            entry.sourceRecord.mediaKind === "series" &&
            entry.mediaIds.includes(options.monitorSeries.seriesId),
        )
        .map((entry) => ({
          provenanceKey: entry.provenanceKey,
          evidenceHash: entry.observationHash,
        })),
    ],
    profiles: [
      {
        captureId,
        sourceProfileId: String(profile.profile.id),
        profileId: f.profile.id,
        version: storedProfile.version,
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
    subtitlePolicies: await householdCaptionSelection(
      db,
      review.report.entries,
      options.householdCaptions === true,
    ),
  });
  const series = options.monitorSeries;
  const seriesEntry =
    series === undefined
      ? undefined
      : review.report.entries.find(
          (entry) =>
            entry.sourceRecord.kind === "media" &&
            entry.sourceRecord.mediaKind === "series" &&
            entry.mediaIds.includes(series.seriesId),
        );
  const selectedRequest =
    series === undefined
      ? request
      : PrepareLibraryHandoffV3Schema.parse({
          ...request,
          schemaVersion: 3,
          plexEditionLabels: "update_in_place",
          seriesMonitoring: [
            {
              schemaVersion: 1,
              seriesId: series.seriesId,
              title: seriesEntry?.mappedMedia[0]?.title,
              provenanceKey: seriesEntry?.provenanceKey,
              includeFutureEpisodes: true,
              includeSpecials: series.includeSpecials,
            },
          ],
        });
  const preparing = await f.commands.prepare(
    f.network.actor,
    crypto.randomUUID(),
    selectedRequest,
  );
  const planId = z.uuid().parse(preparing.handoffId);
  if (series !== undefined)
    f.network.context.plex.metadataForEditionEdit = () =>
      Promise.reject(
        new Error("TV adoption must not request a movie edition edit"),
      );
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
      schemaVersion: selectedRequest.schemaVersion,
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      acknowledgeRecoveryHolds: true,
    },
  );
  await observe(planId);
  const receiptId = await applyPreparedHandoff(
    f.context,
    { planId, operationId: z.uuid().parse(applied.operationId) },
    await prepareHandoffFiles(f.context, planId),
  );
  const assets = await Promise.all(
    files.map((selectedFile) =>
      db.libraryAsset.findUniqueOrThrow({
        where: { path: selectedFile.targetPath },
      }),
    ),
  );
  const asset = assets[0];
  if (asset === undefined) throw new Error("Actual multi-file import is empty");
  return { asset, assets, receiptId, reviewId: review.id };
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
            file: source.asset.path,
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
