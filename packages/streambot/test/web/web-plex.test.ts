import { afterEach, describe, expect, test, vi } from "vitest";
import {
  LibraryPageSchema,
  LibraryTitlesPageSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { WebArtwork } from "@shepherdjerred/streambot/web/server/artwork.ts";
import { PlexArtworkUnavailableError } from "@shepherdjerred/streambot/metadata/plex.ts";
import { fixturePoster } from "./web-fixture-media.ts";
import { GUILD, LIBRARY, webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});
const image = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
function get(path: string) {
  if (fixture === undefined) throw new Error("Expected a web fixture");
  return new Request("http://127.0.0.1:8080" + path, {
    headers: { cookie: fixture.cookie },
  });
}

describe("Plex Library web browsing", () => {
  test("groups shows before pagination and preserves file and episode playback selections", async () => {
    const local = webFixture(undefined, undefined, false, {
      plexArtwork: { image: () => Promise.resolve(image) },
    });
    fixture = local;
    local.setPlexEnabled(true);
    const response = await local.handler(
      get(`/api/library?guildId=${GUILD}&view=titles`),
    );
    const page = LibraryTitlesPageSchema.parse(await response.json());
    expect(page.total).toBe(5);
    const show = page.items.find(
      (item) => item.kind === "series" && item.title === "Severance",
    );
    expect(show).toMatchObject({ kind: "series", episodes: 2, seasons: 1 });
    if (show?.kind !== "series") throw new Error("Expected a show card");
    expect(() =>
      local.catalog.select({ kind: "library", id: show.id }, "owner"),
    ).toThrow("no longer in the library");
    const episodesResponse = await local.handler(
      get(`/api/library?guildId=${GUILD}&series=Severance&view=entries`),
    );
    const episodes = LibraryPageSchema.parse(await episodesResponse.json());
    expect(episodes.items.map((item) => item.episode)).toEqual([1, 2]);
    const episode = episodes.items[0];
    if (episode === undefined) throw new Error("Expected an episode");
    expect(
      local.catalog.select({ kind: "library", id: episode.id }, "owner").source,
    ).toMatchObject({ kind: "file", path: "/media/tv/severance/1-1.mkv" });
    expect(JSON.stringify(page)).not.toContain("/media/");
    expect(local.allocations()).toBe(0);
    local.setPlexEnabled(false);
    const legacyResponse = await local.handler(
      get(`/api/library?guildId=${GUILD}&view=titles`),
    );
    const legacy = LibraryPageSchema.parse(await legacyResponse.json());
    expect(legacy.total).toBe(6);
  });

  test("a long episode list occupies one title slot and collection/query filters still apply", async () => {
    const library = [
      ...LIBRARY,
      ...Array.from({ length: 80 }, (_, index) => ({
        title: `Episode ${String(index + 3)}`,
        path: `/media/tv/severance/${String(index + 3)}.mkv`,
        relativePath: `severance/${String(index + 3)}.mkv`,
        library: "tv",
        series: "Severance",
        season: 2,
        episode: index + 3,
      })),
      ...Array.from({ length: 52 }, (_, index) => ({
        title: `Movie ${String(index)}`,
        path: `/media/movies/${String(index)}.mkv`,
        relativePath: `${String(index)}.mkv`,
        library: "movies",
      })),
    ];
    fixture = webFixture(undefined, undefined, false, { library });
    fixture.setPlexEnabled(true);
    const first = LibraryTitlesPageSchema.parse(
      fixture.catalog.browse(new URLSearchParams({ view: "titles" }), true),
    );
    const next = LibraryTitlesPageSchema.parse(
      fixture.catalog.browse(
        new URLSearchParams({ view: "titles", offset: "50" }),
        true,
      ),
    );
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(57);
    expect(next.items).toHaveLength(7);
    expect(
      [...first.items, ...next.items].filter(
        (item) => item.kind === "series" && item.series === "Severance",
      ),
    ).toHaveLength(1);
    const filtered = LibraryTitlesPageSchema.parse(
      fixture.catalog.browse(
        new URLSearchParams({
          view: "titles",
          library: "tv",
          query: "Severance",
        }),
        true,
      ),
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.title).toBe("Severance");
  });

  test("authorized artwork returns private image bytes and membership is checked before fetching", async () => {
    const provider = { image: vi.fn(() => Promise.resolve(image)) };
    fixture = webFixture(undefined, undefined, false, {
      plexArtwork: provider,
    });
    fixture.setPlexEnabled(true);
    const entry = LIBRARY[0];
    if (entry === undefined) throw new Error("Expected a library file");
    const url = fixture.catalog.artwork.forEntry(entry, GUILD);
    if (url === undefined) throw new Error("Expected an image URL");
    const response = await fixture.handler(get(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("location")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image.bytes);
    expect(provider.image).toHaveBeenCalledTimes(1);
    fixture.setMember(false);
    const denied = await fixture.handler(get(url));
    expect(denied.status).toBe(403);
    expect(provider.image).toHaveBeenCalledTimes(1);
    const anonymous = await fixture.handler(
      new Request("http://127.0.0.1:8080" + url),
    );
    expect(anonymous.status).toBe(401);
  });

  test("Plex absence and outages do not trigger TMDB lookup", async () => {
    const lookup = vi.fn(fixturePoster);
    const provider = { image: vi.fn(() => Promise.resolve(null)) };
    const artwork = new WebArtwork(() => LIBRARY, lookup, provider);
    const entry = LIBRARY[0];
    if (entry === undefined) throw new Error("Expected an entry");
    const url = new URL(
      artwork.forEntry(entry, GUILD) ?? "",
      "http://fixture.test",
    );
    const id = url.searchParams.get("id") ?? "";
    await expect(artwork.resolve(id, true)).rejects.toMatchObject({
      status: 404,
    });
    provider.image.mockRejectedValueOnce(new PlexArtworkUnavailableError());
    await expect(artwork.resolve(id, true)).rejects.toMatchObject({
      status: 502,
    });
    expect(lookup).not.toHaveBeenCalled();
    const legacy = await artwork.resolve(id, false);
    expect(legacy.status).toBe(302);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
