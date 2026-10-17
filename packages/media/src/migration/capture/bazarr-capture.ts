import { z } from "zod";
import {
  MAX_MIGRATION_RECORDS,
  MigrationRecordSchema,
  MigrationSnapshotSchema,
  type MigrationRecord,
} from "#shared/migration.ts";
import { CaptureReader, CaptureReadError } from "./capture-http.ts";
import {
  finishCapture,
  failureReason,
  type CapturePass,
} from "./capture-passes.ts";
import type { BazarrSubtitleWire } from "./bazarr-wire.ts";
import {
  BazarrProfileWire,
  BazarrMovieWire,
  BazarrSeriesWire,
  BazarrEpisodeWire,
  sourceProfile,
} from "./bazarr-wire.ts";

type Source = { sourceInstanceId: string; baseUrl: string; apiKey: string };
type Profile = z.infer<typeof BazarrProfileWire>;
function add(records: MigrationRecord[], value: unknown) {
  if (records.length >= MAX_MIGRATION_RECORDS)
    throw new CaptureReadError("record_limit");
  records.push(MigrationRecordSchema.parse(value));
}
async function paged<T>(
  reader: CaptureReader,
  endpoint: string,
  schema: z.ZodType<T>,
  consume: (row: T) => Promise<void>,
) {
  let total: number | undefined;
  for (let start = 0; total === undefined || start < total; start += 100) {
    const page = await reader.read(
      `api/${endpoint}?start=${String(start)}&length=100`,
      z.object({
        total: z.number().int().nonnegative(),
        data: z.array(schema).max(100),
      }),
    );
    if (page.total > MAX_MIGRATION_RECORDS)
      throw new CaptureReadError("record_limit");
    if (total !== undefined && total !== page.total)
      throw new CaptureReadError("read_failed");
    total = page.total;
    if (page.data.length !== Math.min(100, total - start))
      throw new CaptureReadError("read_failed");
    for (const row of page.data) await consume(row);
  }
}
function appendMedia(input: {
  records: MigrationRecord[];
  kind: "radarr" | "sonarr";
  sourceMediaId: string;
  profile: Profile | null;
  subtitles: z.infer<typeof BazarrSubtitleWire>[];
}) {
  const { records, profile, kind, sourceMediaId } = input;
  const mediaSourceId = `${kind}:${sourceMediaId}`;
  const managerReference = { kind, sourceMediaId, sourceInstanceId: null };
  add(records, {
    kind: "subtitle_preference",
    sourceId: mediaSourceId,
    mediaSourceId,
    languages: [...new Set(profile?.items.map((item) => item.language))].sort(),
    hearingImpaired: null,
    forced: null,
    sourceProfile: profile === null ? null : sourceProfile(profile),
    managerReference,
  });
  for (const subtitle of input.subtitles)
    add(records, {
      kind: "subtitle",
      sourceId: `${kind}:${String(subtitle.id)}`,
      mediaSourceId,
      path: subtitle.path,
      language: subtitle.code2 ?? subtitle.code3 ?? "und",
      checksum: null,
      provenance: subtitle.embedded_track_id === null ? "unknown" : "embedded",
      embeddedTrackId: subtitle.embedded_track_id,
      hearingImpaired: subtitle.hi,
      forced: subtitle.forced,
      managerReference,
    });
}
function profileFor(profiles: Map<number, Profile>, id: number | null) {
  if (id === null) return null;
  const profile = profiles.get(id);
  if (profile === undefined) throw new CaptureReadError("read_failed");
  return profile;
}
async function inventory(reader: CaptureReader, records: MigrationRecord[]) {
  const profileRows = await reader.read(
    "api/system/languages/profiles",
    z.array(BazarrProfileWire).max(1000),
  );
  const profiles = new Map(
    profileRows.map((profile) => [profile.profileId, profile]),
  );
  if (profiles.size !== profileRows.length)
    throw new CaptureReadError("read_failed");
  await paged(reader, "movies", BazarrMovieWire, (movie) => {
    appendMedia({
      records,
      kind: "radarr",
      sourceMediaId: String(movie.radarrId),
      profile: profileFor(profiles, movie.profileId),
      subtitles: movie.subtitles,
    });
    return Promise.resolve();
  });
  await paged(reader, "series", BazarrSeriesWire, async (series) => {
    const profile = profileFor(profiles, series.profileId);
    appendMedia({
      records,
      kind: "sonarr",
      sourceMediaId: `series:${String(series.sonarrSeriesId)}`,
      profile,
      subtitles: [],
    });
    const episodes = await reader.read(
      `api/episodes?seriesid[]=${String(series.sonarrSeriesId)}`,
      z.object({ data: z.array(BazarrEpisodeWire).max(MAX_MIGRATION_RECORDS) }),
    );
    for (const episode of episodes.data) {
      if (episode.sonarrSeriesId !== series.sonarrSeriesId)
        throw new CaptureReadError("read_failed");
      appendMedia({
        records,
        kind: "sonarr",
        sourceMediaId: `episode:${String(episode.sonarrEpisodeId)}`,
        profile,
        subtitles: episode.subtitles,
      });
    }
  });
}
async function pass(
  source: Source,
  fetcher: typeof fetch,
): Promise<CapturePass> {
  const reader = new CaptureReader(source, fetcher);
  const records: MigrationRecord[] = [];
  let version = "unknown";
  try {
    const status = await reader.read(
      "api/system/status",
      z.object({
        data: z.object({
          bazarr_version: MigrationSnapshotSchema.shape.sourceVersion,
        }),
      }),
    );
    version = status.data.bazarr_version;
    await inventory(reader, records);
    return { records, version, pages: reader.pages, reason: "complete" };
  } catch (error) {
    return {
      records,
      version,
      pages: reader.pages,
      reason: failureReason(error),
    };
  }
}
/** Preserves source profile semantics; numeric manager IDs remain unbound to any manager instance. */
export async function captureBazarr(
  source: Source,
  fetcher: typeof fetch = fetch,
) {
  const startedAt = new Date().toISOString();
  const first = await pass(source, fetcher);
  const second = await pass(source, fetcher);
  return finishCapture({
    sourceKind: "bazarr",
    sourceInstanceId: source.sourceInstanceId,
    startedAt,
    first,
    second,
    endpoints: ["subtitle_preferences", "subtitles"],
  });
}
