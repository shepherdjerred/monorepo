import { z } from "zod";
import {
  MusicAlbumSchema,
  MusicQuerySchema,
  type MusicEntity,
  type MusicTrack,
} from "./contracts.ts";
import { MusicError } from "./errors.ts";

const OptionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const OptionalLength = z
  .number()
  .nullish()
  .transform((value) => value ?? undefined);
const ArtistSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  disambiguation: OptionalText,
});
const CreditSchema = z.array(z.object({ name: z.string() }));
const GroupSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  "artist-credit": CreditSchema.optional(),
  "first-release-date": OptionalText,
  "primary-type": OptionalText,
});
const RecordingSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  length: OptionalLength,
  disambiguation: OptionalText,
  "artist-credit": CreditSchema,
});
const ReleaseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  date: OptionalText,
  country: OptionalText,
  status: OptionalText,
  "artist-credit": CreditSchema.optional(),
  disambiguation: OptionalText,
});
const MediumSchema = z.object({
  position: z.number(),
  tracks: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      position: z.number(),
      length: z.number().nullish(),
      "artist-credit": CreditSchema.optional(),
      recording: RecordingSchema,
    }),
  ),
});
const USER_AGENT = "Streambot/1.0 (https://streambot.sjer.red)";

export class MusicCatalog {
  private readonly cache = new Map<string, { value: unknown; until: number }>();
  private tail: Promise<undefined> = Promise.resolve(undefined);
  private nextRequest = 0;
  private pendingRequests = 0;
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request(path: string, signal: AbortSignal): Promise<unknown> {
    const cached = this.cache.get(path);
    if (cached !== undefined && cached.until > Date.now()) return cached.value;
    if (this.pendingRequests >= 30)
      throw new MusicError(
        429,
        "catalog_busy",
        "Music search is busy. Try again shortly.",
      );
    this.pendingRequests += 1;
    const previous = this.tail;
    const pending = Promise.withResolvers<undefined>();
    this.tail = pending.promise;
    await previous;
    try {
      signal.throwIfAborted();
      const second = this.cache.get(path);
      if (second !== undefined && second.until > Date.now())
        return second.value;
      if (this.nextRequest > Date.now())
        await Bun.sleep(this.nextRequest - Date.now());
      signal.throwIfAborted();
      this.nextRequest = Date.now() + 1100;
      const response = await this.fetcher(
        "https://musicbrainz.org/ws/2/" + path,
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
        },
      );
      if (!response.ok)
        throw new Error("Music catalog is unavailable. Try again shortly.");
      const value: unknown = await response.json();
      if (this.cache.size >= 500) {
        const key = this.cache.keys().next().value;
        if (key !== undefined) this.cache.delete(key);
      }
      this.cache.set(path, { value, until: Date.now() + 5 * 60_000 });
      return value;
    } finally {
      this.pendingRequests -= 1;
      pending.resolve(undefined);
    }
  }

  async browse(params: URLSearchParams, signal: AbortSignal) {
    const query = musicQuery(params);
    if (query.artist !== undefined) {
      const data = z
        .object({
          "release-group-count": z.number(),
          "release-groups": z.array(GroupSchema),
        })
        .parse(
          await this.request(
            "release-group?" +
              new URLSearchParams({
                artist: query.artist,
                fmt: "json",
                limit: String(query.limit),
                offset: String(query.offset),
                type: "album|ep|single",
              }).toString(),
            signal,
          ),
        );
      return {
        items: data["release-groups"].map((g): MusicEntity => ({
          kind: "album",
          id: g.id,
          title: g.title,
          subtitle: g["primary-type"] ?? "Release",
          artworkId: g.id,
          ...(g["first-release-date"] === undefined
            ? {}
            : { date: g["first-release-date"] }),
        })),
        total: data["release-group-count"],
        offset: query.offset,
      };
    }
    if (query.query === "")
      return { items: [], total: 0, offset: query.offset };
    const types =
      query.type === "all"
        ? (["artist", "album", "song"] as const)
        : [query.type];
    const items: MusicEntity[] = [];
    let total = 0;
    let hasMore = false;
    for (const [typeIndex, type] of types.entries()) {
      const limit =
        Math.floor(query.limit / types.length) +
        (typeIndex < query.limit % types.length ? 1 : 0);
      const offset = Math.floor(query.offset / query.limit) * limit;
      const entity =
        type === "album"
          ? "release-group"
          : type === "song"
            ? "recording"
            : "artist";
      const path =
        entity +
        "?" +
        new URLSearchParams({
          query: query.query,
          fmt: "json",
          limit: String(limit),
          offset: String(offset),
          dismax: "true",
        }).toString();
      const value = await this.request(path, signal);
      if (type === "artist") {
        const data = z
          .object({ count: z.number(), artists: z.array(ArtistSchema) })
          .parse(value);
        total += data.count;
        hasMore ||= offset + limit < data.count;
        items.push(
          ...data.artists.map((a): MusicEntity => ({
            kind: "artist",
            id: a.id,
            title: a.name,
            subtitle: a.disambiguation ?? "Artist",
          })),
        );
      } else if (type === "album") {
        const data = z
          .object({ count: z.number(), "release-groups": z.array(GroupSchema) })
          .parse(value);
        total += data.count;
        hasMore ||= offset + limit < data.count;
        items.push(
          ...data["release-groups"].map((a): MusicEntity => ({
            kind: "album",
            id: a.id,
            title: a.title,
            subtitle:
              a["artist-credit"]?.map((c) => c.name).join(", ") ?? "Album",
            artworkId: a.id,
          })),
        );
      } else {
        const data = z
          .object({ count: z.number(), recordings: z.array(RecordingSchema) })
          .parse(value);
        total += data.count;
        hasMore ||= offset + limit < data.count;
        items.push(
          ...data.recordings
            .filter((r) => r["artist-credit"].length > 0)
            .map((r): MusicEntity => ({
              kind: "song",
              id: r.id,
              title: r.title,
              subtitle: r["artist-credit"].map((a) => a.name).join(", "),
              track: recordingTrack(r),
            })),
        );
      }
    }
    return { items, total, offset: query.offset, hasMore };
  }

  async album(id: string, edition: string | undefined, signal: AbortSignal) {
    z.uuid().parse(id);
    const group = z
      .object({ title: z.string(), "artist-credit": CreditSchema })
      .parse(
        await this.request(
          "release-group/" + id + "?inc=artist-credits&fmt=json",
          signal,
        ),
      );
    const releases = z.object({ releases: z.array(ReleaseSchema) }).parse(
      await this.request(
        "release?" +
          new URLSearchParams({
            "release-group": id,
            fmt: "json",
            limit: "100",
          }).toString(),
        signal,
      ),
    ).releases;
    const ordered = releases.toSorted(
      (a, b) =>
        Number(b.status === "Official") - Number(a.status === "Official") ||
        (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
        a.id.localeCompare(b.id),
    );
    const selected =
      edition === undefined
        ? ordered[0]
        : ordered.find((r) => r.id === z.uuid().parse(edition));
    if (selected === undefined)
      throw new Error("This album edition is unavailable.");
    const release = z
      .object({ media: z.array(MediumSchema) })
      .parse(
        await this.request(
          "release/" + selected.id + "?inc=recordings+artist-credits&fmt=json",
          signal,
        ),
      );
    const tracks: MusicTrack[] = release.media
      .toSorted((a, b) => a.position - b.position)
      .flatMap((medium) =>
        medium.tracks
          .toSorted((a, b) => a.position - b.position)
          .map((t) => ({
            ...recordingTrack(t.recording),
            title: t.title,
            album: group.title,
            artworkId: id,
            artists: (t["artist-credit"] ?? t.recording["artist-credit"]).map(
              (a) => a.name,
            ),
            ...(t.length == null ? {} : { durationSeconds: t.length / 1000 }),
          })),
      );
    return MusicAlbumSchema.parse({
      id,
      title: group.title,
      artist: group["artist-credit"].map((a) => a.name).join(", "),
      releaseId: selected.id,
      editions: ordered.map((r) => ({
        id: r.id,
        label:
          [r.date, r.country, r.disambiguation, r.status]
            .filter(Boolean)
            .join(" · ") || r.id,
      })),
      tracks,
    });
  }
}

function recordingTrack(
  recording: z.infer<typeof RecordingSchema>,
): MusicTrack {
  return {
    provider: "musicbrainz",
    id: recording.id,
    title: recording.title,
    artists: recording["artist-credit"].map((a) => a.name),
    canonicalUrl: "https://musicbrainz.org/recording/" + recording.id,
    ...(recording.length === undefined
      ? {}
      : { durationSeconds: recording.length / 1000 }),
    ...(recording.disambiguation === undefined
      ? {}
      : { version: recording.disambiguation }),
  };
}

function musicQuery(params: URLSearchParams) {
  const input = MusicQuerySchema.safeParse(Object.fromEntries(params));
  if (!input.success)
    throw new MusicError(
      400,
      "music_query",
      "Use a shorter search and a valid artist, album, or page.",
    );
  return input.data;
}
