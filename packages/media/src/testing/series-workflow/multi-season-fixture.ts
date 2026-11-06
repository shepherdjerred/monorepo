import path from "node:path";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { PlexItem } from "#integrations/plex.ts";
import { createManagedSeriesFixture } from "./fixture.ts";
import { managedSeriesWire } from "./wire.ts";
import { adoptLibraryBindingSource } from "#automation/plex-binding/library.test-fixture.ts";
import { mediaFixture } from "#migration/bundle-test-fixtures.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { matchRelease } from "#domain/release-parser.ts";
import { loadProfile } from "#automation/acquisition-candidates.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { createSeriesRequester } from "./requester.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";

/** Two actual capture/review/prepare/apply receipts precede a newly created multi-season transfer. */
export async function createMultiSeasonSeriesFixture(
  db: Database,
  directoryCreated: (directory: string) => void,
  bytes: {
    original: Uint8Array;
    upgrade: Uint8Array;
    personal?: boolean;
    episodeCount?: number;
    householdCaptions?: boolean;
  },
) {
  // Random hexadecimal UUID segments can look like extra E-number tokens.
  // Choose the synthetic catalog name before capture, keeping real parser protections.
  const suffix = crypto
    .randomUUID()
    .replaceAll("-", "")
    .replaceAll(/\d/gu, (digit) => String.fromCodePoint(103 + Number(digit)));
  const f = await createManagedSeriesFixture(db, directoryCreated, {
    ...bytes,
    title: `Synthetic Anime ${suffix}`,
  });
  const count = bytes.episodeCount ?? 2;
  const target = path.join(
    f.files.roots.tv.library,
    `${f.series.title}.S02E01-E${String(count).padStart(2, "0")}.mkv`,
  );
  await writeFile(target, f.bytes, { flag: "wx" });
  const season = await db.mediaItem.create({
    data: {
      kind: "season",
      title: `${f.series.title}: Season 2`,
      parentId: f.series.id,
      seasonNumber: 2,
    },
  });
  const episodes = await db.mediaItem.createManyAndReturn({
    data: Array.from({ length: count }, (_, index) => index + 1).map(
      (episodeNumber) => ({
        kind: "episode",
        title: `Season 2 Episode ${String(episodeNumber)}`,
        parentId: season.id,
        seasonNumber: 2,
        episodeNumber,
        runtimeMinutes: 1,
        originalLanguage: "en",
      }),
    ),
  });
  episodes.sort(
    (a, b) =>
      z.number().parse(a.episodeNumber) - z.number().parse(b.episodeNumber),
  );
  await db.mediaItem.update({
    where: { id: f.series.id },
    data: { version: { increment: 1 } },
  });
  const rootKey = z.int().positive().parse(Number(f.plexShow.ratingKey));
  const seasonKey = String(rootKey + 200_000);
  const items: PlexItem[] = episodes.map((episode, index) => ({
    ratingKey: String(rootKey + 200_001 + index),
    type: "episode",
    title: episode.title,
    librarySectionID: 2,
    grandparentRatingKey: f.plexShow.ratingKey,
    parentRatingKey: seasonKey,
    parentIndex: 2,
    index: z.int().positive().parse(episode.episodeNumber),
    Media: [
      {
        Part: [
          {
            id: rootKey + 300_001 + index,
            file: target,
            size: Buffer.byteLength(f.bytes),
          },
        ],
      },
    ],
  }));
  const previousMetadata = f.network.context.plex.metadata.bind(
    f.network.context.plex,
  );
  f.network.context.plex.libraryPage = () =>
    Promise.resolve({ total: items.length, items });
  f.network.context.plex.metadata = (key) => {
    if (key === f.plexShow.ratingKey) return Promise.resolve(f.plexShow);
    if (key === seasonKey)
      return Promise.resolve({
        ratingKey: seasonKey,
        type: "season",
        title: "Season 2",
        index: 2,
        parentRatingKey: f.plexShow.ratingKey,
      });
    const item = items.find((candidate) => candidate.ratingKey === key);
    return item === undefined ? previousMetadata(key) : Promise.resolve(item);
  };
  const root = mediaFixture("1", "series", {
    tmdb: z.number().parse(f.series.tmdbId),
  });
  const adopted = await adoptLibraryBindingSource(f.handoff, {
    kind: "tv",
    edition: "default",
    targetPath: target,
    qualitySourceId: "5",
    ...(bytes.householdCaptions === undefined
      ? {}
      : { householdCaptions: bytes.householdCaptions }),
    media: [
      root,
      ...episodes.map((episode) => ({
        ...root,
        sourceId: `s2episode:${String(episode.episodeNumber)}`,
        mediaKind: "episode" as const,
        externalIds: {},
        parentSourceId: root.sourceId,
        season: 2,
        episode: episode.episodeNumber,
      })),
    ],
  });
  const ids = [...f.ids, ...episodes.map((episode) => episode.id)];
  const wire = managedSeriesWire(db, {
    seriesId: f.series.id,
    mediaIds: ids,
    title: f.series.title,
    downloads: f.files.roots.tv.downloads,
    bytes: bytes.upgrade,
    show: f.plexShow,
    items: [...f.plexItems, ...items],
    seasonRange: { first: 1, last: 2 },
    members: [
      { season: 1, first: 1, last: count, bytes: bytes.upgrade },
      { season: 2, first: 1, last: count, bytes: bytes.upgrade },
    ],
  });
  const context = { ...f.context, ...wire };
  const binding = await db.operation.findUniqueOrThrow({
    where: {
      idempotencyKey: `library-plex:${adopted.receiptId}:${adopted.asset.id}:0`,
    },
  });
  const verified = await verifyLibraryPlexBinding(
    context,
    LibraryPlexBindingInputV1Schema.parse(binding.payload),
    testPlexBindingExecution(),
  );
  if (verified.status !== "verified" || verified.bindingCount !== count)
    throw new Error("Actual second-season binding failed");
  const profile = await loadProfile(db, z.uuid().parse(f.ids[0]));
  if (profile === null)
    throw new Error("Actual series fixture profile missing");
  const sources = await wire.providers.withProvider("knaben", (client) =>
    client.search({ query: f.series.title, kind: "tv" }),
  );
  const source = sources[0];
  if (source === undefined || sources.length !== 1)
    throw new Error("Actual multi-season provider observation missing");
  const primary = f.episodes[0];
  if (primary === undefined)
    throw new Error("Actual first-season primary missing");
  const literal = matchRelease({
    id: crypto.randomUUID(),
    providerId: source.providerId,
    title: source.title,
    sizeBytes: source.sizeBytes,
    media: {
      id: z.uuid().parse(f.ids[0]),
      kind: "episode",
      title: primary.title,
      year: null,
      seriesTitle: f.series.title,
      seriesYear: 2020,
    },
    knownEpisodes: [...f.episodes, ...episodes].map((episode) => ({
      mediaId: episode.id,
      season: z.number().parse(episode.seasonNumber),
      episode: z.number().parse(episode.episodeNumber),
    })),
  }).attributes;
  const retained = await persistCandidateSnapshot(context, {
    source,
    attributes: literal,
    evaluation: evaluateRelease(literal, profile, [z.uuid().parse(f.ids[0])]),
    searchedForMediaId: z.uuid().parse(f.ids[0]),
  });
  if (retained === null)
    throw new Error("Actual original legacy interpretation was not retained");
  let operation = await db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  if (bytes.personal === true) {
    const requester = await createSeriesRequester(db);
    const profileDefault = await db.qualityProfileDefault.findUnique({
      where: { kind: "series" },
    });
    await requester.commands.setProfileDefault(
      f.network.actor,
      crypto.randomUUID(),
      "series",
      {
        expectedVersion: profileDefault?.version ?? 0,
        profileId: f.profile.id,
      },
    );
    const requested = await requester.commands.createRequest(
      requester.actor,
      crypto.randomUUID(),
      {
        mediaId: f.series.id,
        subtitleLanguages: [],
        includeFutureEpisodes: false,
        includeSpecials: false,
      },
    );
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: z.uuid().parse(requested.requestId) },
    });
    await createCoverageActivities({ db }).expandMediaRequest({
      operationId: z.uuid().parse(requested.operationId),
      requestId: request.id,
      requestVersion: request.version,
      cursor: null,
    });
    operation = await db.operation.findFirstOrThrow({
      where: {
        kind: "reconcile_media",
        targetId: z.uuid().parse(f.ids[0]),
        userId: requester.actor.id,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  const input = z
    .object({
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int().nonnegative(),
    })
    .parse(operation.payload);
  return {
    ...f,
    ids,
    context,
    input,
    wire,
    second: adopted,
    secondTarget: target,
    secondEpisodes: episodes,
    originalAssetIds: [f.asset.id, adopted.asset.id],
    retainedReleaseId: retained.id,
    acquired: createAcquisitionActivities(context),
    publication: createPublicationActivities(context),
  };
}
