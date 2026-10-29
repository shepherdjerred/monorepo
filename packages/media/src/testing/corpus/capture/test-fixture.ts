import { expect, vi } from "vitest";
import type { FetchTransport } from "#integrations/http.ts";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import type { InventorySource } from "#migration/source-inventory.ts";

/** Fictional installed wire resources; only the independently captured profile snapshot is real. */
export function installedCaptureFixture() {
  const sources: InventorySource[] = [
    {
      source: "radarr",
      baseUrl: "http://127.0.0.1:17878",
      apiKey: "synthetic-radarr-credential",
    },
    {
      source: "sonarr",
      baseUrl: "http://127.0.0.1:18989",
      apiKey: "synthetic-sonarr-credential",
    },
  ];
  const movie = {
    id: 11,
    title: "Paper Lantern",
    year: 2024,
    tmdbId: 101,
    alternateTitles: [{ title: "Lantern" }],
    runtime: 97,
    qualityProfileId: 1,
    monitored: true,
    apiKey: "discard-this-field",
    downloadUrl: "https://discard.invalid/private",
  };
  const show = {
    id: 21,
    title: "Cloud Harbor",
    year: 2023,
    tvdbId: 201,
    qualityProfileId: 9,
    monitored: true,
  };
  const episodes = [
    {
      id: 31,
      seriesId: 21,
      title: "Arrival",
      seasonNumber: 1,
      episodeNumber: 1,
      episodeFileId: 41,
      monitored: true,
    },
    {
      id: 32,
      seriesId: 21,
      seasonNumber: 1,
      episodeNumber: 2,
      episodeFileId: 41,
      monitored: true,
    },
  ];
  const movieFiles = [
    {
      id: 12,
      movieId: 11,
      path: "/data/movies/Paper Lantern.mkv",
      size: 2_345_678_901,
      quality: { quality: { id: 1 } },
    },
  ];
  const episodeFiles = [
    {
      id: 41,
      seriesId: 21,
      path: "/data/tv/Cloud Harbor/S01E01-E02.mkv",
      size: 3_456_789_012,
      quality: { quality: { id: 1 } },
    },
  ];
  const calls: string[] = [];
  let change: ((url: URL, body: unknown) => unknown) | undefined;
  const transport = vi.fn<FetchTransport>((url, init) => {
    const source = sources.find(
      (value) => new URL(value.baseUrl).port === url.port,
    );
    const profile = snapshot.inventories.find(
      (value) => value.source === source?.source,
    );
    if (source === undefined || profile === undefined)
      throw new Error("Unexpected synthetic capture source");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("X-Api-Key")).toBe(source.apiKey);
    calls.push(`${source.source}:${url.pathname}${url.search}`);
    const bodies: Record<string, unknown> = {
      "/api/v3/system/status": {
        version: profile.version,
        apiKey: "discard-this-field",
      },
      "/api/v3/qualityprofile": profile.profiles,
      "/api/v3/customformat": profile.customFormats,
      "/api/v3/qualitydefinition": profile.qualityDefinitions,
      "/api/v3/config/mediamanagement": {
        downloadPropersAndRepacks: profile.properPreference,
      },
      "/api/v3/movie": [movie],
      "/api/v3/moviefile": movieFiles,
      "/api/v3/series": [show],
      "/api/v3/episode": episodes,
      "/api/v3/episodefile": episodeFiles,
    };
    if (!(url.pathname in bodies))
      throw new Error("Unexpected synthetic capture endpoint");
    const body = bodies[url.pathname];
    return Promise.resolve(
      Response.json(change === undefined ? body : change(url, body)),
    );
  });
  return {
    sources,
    transport,
    calls,
    movie,
    show,
    episodes,
    movieFiles,
    episodeFiles,
    change: (callback: typeof change) => {
      change = callback;
    },
  };
}
