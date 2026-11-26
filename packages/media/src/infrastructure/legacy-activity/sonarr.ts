import { z } from "zod";
import { tokenHash } from "#application/security.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  legacyActivityKey,
  type LegacyActivityEvent,
} from "#shared/legacy-activity/contract.ts";
import {
  MigrationRecordSchema,
  type MigrationRecord,
} from "#shared/migration.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";
import { catalogIdentity } from "#migration/catalog-targets.ts";
import { sharesCatalogIdentity } from "#migration/normalize.ts";
import { snapshotHash } from "#migration/profile-import.ts";

type EpisodeEvidence = {
  key: string;
  seriesIds: Extract<MigrationRecord, { kind: "media" }>["externalIds"];
  tmdbId: number;
  season: number;
  episode: number;
};

/** Use the same immutable claim binding as the native Sonarr capture. */
function captureInstanceId(pvcUid: string): string {
  return tokenHash(`kubernetes-pvc:media/sonarr-pvc:${pvcUid}`);
}

async function sourceEpisodes(
  tx: Prisma.TransactionClient,
  events: readonly LegacyActivityEvent[],
) {
  const references = events.flatMap((event) =>
    event.source === "sonarr" &&
    event.seriesId !== null &&
    event.episodeId !== null
      ? [
          {
            key: legacyActivityKey(event),
            instanceId: captureInstanceId(event.sourceInstanceId),
            series: `series:${String(event.seriesId)}`,
            episode: `episode:${String(event.episodeId)}`,
          },
        ]
      : [],
  );
  if (references.length === 0) return [];
  const captures = await tx.migrationCapture.findMany({
    where: {
      sourceKind: "sonarr",
      sourceInstanceId: {
        in: [...new Set(references.map((row) => row.instanceId))],
      },
      complete: true,
      stable: true,
    },
    distinct: ["sourceInstanceId"],
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    select: {
      sourceInstanceId: true,
      records: {
        where: {
          kind: "media",
          sourceId: {
            in: [
              ...new Set(
                references.flatMap((row) => [row.series, row.episode]),
              ),
            ],
          },
        },
        select: { payload: true, observationHash: true, provenanceKey: true },
      },
    },
  });
  const byInstance = new Map(
    captures.map((capture) => [
      capture.sourceInstanceId,
      new Map(
        capture.records.map((stored) => {
          const value = MigrationRecordSchema.parse(stored.payload);
          if (
            snapshotHash(z.json().parse(value)) !== stored.observationHash ||
            recordKey(
              {
                sourceKind: "sonarr",
                sourceInstanceId: capture.sourceInstanceId,
              },
              value,
            ) !== stored.provenanceKey
          )
            throw new Error("Stored Sonarr capture identity changed");
          return [value.sourceId, value];
        }),
      ),
    ]),
  );
  return references.flatMap((reference): EpisodeEvidence[] => {
    const captured = byInstance.get(reference.instanceId);
    const episode = captured?.get(reference.episode);
    const series = captured?.get(reference.series);
    if (
      episode?.kind !== "media" ||
      episode.mediaKind !== "episode" ||
      series?.kind !== "media" ||
      series.mediaKind !== "series" ||
      episode.parentSourceId !== series.sourceId ||
      episode.season === null ||
      episode.episode === null ||
      series.externalIds.tmdb === undefined
    )
      return [];
    return [
      {
        key: reference.key,
        seriesIds: series.externalIds,
        tmdbId: series.externalIds.tmdb,
        season: episode.season,
        episode: episode.episode,
      },
    ];
  });
}

const seriesSelect = {
  id: true,
  kind: true,
  tmdbId: true,
  externalIds: true,
  seasonNumber: true,
} satisfies Prisma.MediaItemSelect;

function coordinateKey(tmdbId: number, season: number, episode: number) {
  return `${String(tmdbId)}:${String(season)}:${String(episode)}`;
}

export async function sonarrActivityLinks(
  tx: Prisma.TransactionClient,
  events: readonly LegacyActivityEvent[],
): Promise<Map<string, string>> {
  const evidence = await sourceEpisodes(tx, events);
  if (evidence.length === 0) return new Map();
  const tmdbIds = [...new Set(evidence.map((row) => row.tmdbId))];
  const seriesWhere: Prisma.MediaItemWhereInput = {
    kind: "series",
    catalogState: "ready",
    OR: [
      { tmdbId: { in: tmdbIds } },
      ...tmdbIds.map((tmdb) => ({
        externalIds: { path: ["tmdb"], equals: tmdb },
      })),
    ],
  };
  const episodes = await tx.mediaItem.findMany({
    where: {
      kind: "episode",
      OR: [
        { parent: seriesWhere },
        { parent: { kind: "season", parent: seriesWhere } },
      ],
    },
    select: {
      id: true,
      seasonNumber: true,
      episodeNumber: true,
      parent: { select: { ...seriesSelect, parent: { select: seriesSelect } } },
    },
  });
  const byCoordinate = new Map<
    string,
    { id: string; ids: ReturnType<typeof catalogIdentity> }[]
  >();
  for (const row of episodes) {
    if (row.seasonNumber === null || row.episodeNumber === null) continue;
    const parent = row.parent;
    const series = parent?.kind === "series" ? parent : parent?.parent;
    if (
      series?.kind !== "series" ||
      (parent?.kind === "season" && parent.seasonNumber !== row.seasonNumber)
    )
      continue;
    const ids = catalogIdentity(series);
    if (ids.tmdb === undefined) continue;
    const key = coordinateKey(ids.tmdb, row.seasonNumber, row.episodeNumber);
    const matches = byCoordinate.get(key) ?? [];
    matches.push({ id: row.id, ids });
    byCoordinate.set(key, matches);
  }
  return new Map(
    evidence.flatMap((source) => {
      const key = coordinateKey(source.tmdbId, source.season, source.episode);
      const matches = byCoordinate
        .get(key)
        ?.filter((row) => sharesCatalogIdentity(source.seriesIds, row.ids));
      return matches?.length === 1
        ? matches.map((match) => [source.key, match.id] as const)
        : [];
    }),
  );
}
