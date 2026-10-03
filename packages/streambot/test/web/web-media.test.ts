import { afterEach, describe, expect, test, vi } from "vitest";
import { WebArtwork } from "@shepherdjerred/streambot/web/server/artwork.ts";
import {
  LibraryPageSchema,
  SnapshotSchema,
  SportsResultsSchema,
  CommandResultSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { CHANNEL, GUILD, LIBRARY, USER, webFixture } from "./web-fixture.ts";
import { fixtureSports } from "./web-fixture-media.ts";

let fixture: ReturnType<typeof webFixture>;
afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
});

function get(path: string) {
  return new Request("http://127.0.0.1:8080" + path, {
    headers: { cookie: fixture.cookie },
  });
}

async function sports(query = "") {
  const response = await fixture.handler(
    get(
      "/api/sports?" +
        new URLSearchParams({ guildId: GUILD, query }).toString(),
    ),
  );
  expect(response.status).toBe(200);
  return SportsResultsSchema.parse(await response.json());
}

describe("web media artwork", () => {
  test("library and playback carry private lazy poster references; authorized images redirect to the real CDN", async () => {
    fixture = webFixture();
    const response = await fixture.handler(
      get("/api/library?guildId=" + GUILD),
    );
    const page = LibraryPageSchema.parse(await response.json());
    const arrival = page.items.find((item) => item.title === "Arrival");
    if (arrival?.artworkUrl === undefined)
      throw new Error("Expected Arrival artwork");
    expect(arrival.artworkUrl).toMatch(/^\/api\/artwork\?/u);
    expect(JSON.stringify(page)).not.toContain("/media/");
    expect(fixture.allocations()).toBe(0);
    const image = await fixture.handler(get(arrival.artworkUrl));
    expect(image.status).toBe(302);
    expect(image.headers.get("location")).toBe(
      "https://image.tmdb.org/t/p/w500/pEzNVQfdzYDzVK0XqxERIw2x2se.jpg",
    );
    expect(image.headers.get("content-security-policy")).toContain(
      "https://image.tmdb.org",
    );
    fixture.setMember(false);
    const deniedImage = await fixture.handler(get(arrival.artworkUrl));
    expect(deniedImage.status).toBe(403);
    fixture.setMember(true);
    await fixture.seed();
    const snapshotResponse = await fixture.handler(
      get("/api/player?guildId=" + GUILD),
    );
    const snapshot = SnapshotSchema.parse(await snapshotResponse.json());
    expect(snapshot.current?.artworkUrl).toBe(arrival.artworkUrl);
  });

  test("episodes share one poster lookup and external metadata cannot introduce arbitrary image hosts", async () => {
    fixture = webFixture();
    const lookup = vi.fn(() =>
      Promise.resolve({
        tmdbTitle: "Severance",
        posterUrl: "https://image.tmdb.org/t/p/w500/series.jpg",
      }),
    );
    const artwork = new WebArtwork(() => LIBRARY, lookup);
    const urls = LIBRARY.filter((entry) => entry.series === "Severance").map(
      (entry) => artwork.forEntry(entry, GUILD),
    );
    const ids = urls.map(
      (url) =>
        new URL(url ?? "", "http://127.0.0.1:8080").searchParams.get("id") ??
        "",
    );
    await Promise.all(ids.map((id) => artwork.resolve(id)));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("Severance", null);
    const source = {
      kind: "url" as const,
      url: "https://www.youtube.com/watch?v=QrR_gm6RqCo",
    };
    expect(
      artwork.forSource(source, GUILD, "http://127.0.0.1/private"),
    ).toBeUndefined();
    expect(
      artwork.forSource(
        source,
        GUILD,
        "https://user:secret@i.ytimg.com/image.jpg",
      ),
    ).toBeUndefined();
    const search = await fixture.catalog.search(
      new URLSearchParams({ query: "Tiny Desk", source: "youtube" }),
      { guildId: GUILD, channelId: CHANNEL, userId: USER },
      "owner",
      new AbortController().signal,
    );
    expect(search[0]?.artworkUrl).toBe(
      "https://i.ytimg.com/vi/QrR_gm6RqCo/hqdefault.jpg",
    );
  });

  test("absent poster metadata leaves media usable and rejects unknown artwork references", async () => {
    fixture = webFixture();
    const missing = new WebArtwork(
      () => LIBRARY,
      () => Promise.resolve(null),
    );
    const entry = LIBRARY[0];
    if (entry === undefined) throw new Error("Expected a library entry");
    const url = new URL(
      missing.forEntry(entry, GUILD) ?? "",
      "http://127.0.0.1:8080",
    );
    await expect(
      missing.resolve(url.searchParams.get("id") ?? ""),
    ).rejects.toThrow("Artwork is unavailable");
    await expect(missing.resolve("unknown")).rejects.toThrow(
      "Artwork is unavailable",
    );
    const disabled = new WebArtwork(() => LIBRARY, undefined);
    expect(disabled.forEntry(entry, GUILD)).toBeUndefined();
  });
});

describe("web live sports", () => {
  test("the web provider choice reaches the catalog before fetching listings", async () => {
    fixture = webFixture();
    const listing = vi.spyOn(fixtureSports, "listToday");
    await sports();
    expect(listing).toHaveBeenLastCalledWith(
      expect.any(AbortSignal),
      "streameast",
    );
    const response = await fixture.handler(
      get("/api/sports?guildId=" + GUILD + "&provider=tvsportslive"),
    );
    expect(response.status).toBe(200);
    expect(listing).toHaveBeenLastCalledWith(
      expect.any(AbortSignal),
      "tvsportslive",
    );
  });
  test("sports listings require the gate and current membership before provider access", async () => {
    fixture = webFixture();
    const browse = vi.spyOn(fixture.catalog.sports, "browse");
    fixture.setSportsEnabled(false);
    const disabled = await fixture.handler(get("/api/sports?guildId=" + GUILD));
    expect(disabled.status).toBe(403);
    expect(browse).not.toHaveBeenCalled();
    fixture.setSportsEnabled(true);
    fixture.setMember(false);
    const nonmember = await fixture.handler(
      get("/api/sports?guildId=" + GUILD),
    );
    expect(nonmember.status).toBe(403);
    expect(browse).not.toHaveBeenCalled();
    expect(fixture.allocations()).toBe(0);
  });

  test("StreamEast search returns opaque events; queue, next and now use the shared sports resolver", async () => {
    fixture = webFixture();
    const today = await sports();
    expect(today).toHaveLength(2);
    expect(today.every((event) => event.provider === "streameast")).toBe(true);
    expect(JSON.stringify(today)).not.toContain("pageUrl");
    expect(fixture.allocations()).toBe(0);
    const matches = await sports("Seattle Seahawks");
    expect(matches).toHaveLength(1);
    const live = matches[0];
    if (live === undefined) throw new Error("Expected the live Seahawks event");
    await fixture.seed();
    for (const [placement, type] of [
      ["queue", "ADD"],
      ["next", "ADD_NEXT"],
      ["now", "PLAY_NOW"],
    ]) {
      const response = await fixture.handler(
        fixture.command({
          action: "play",
          placement,
          selection: { kind: "sports", id: live.id },
        }),
      );
      expect(response.status).toBe(200);
      const result = CommandResultSchema.parse(await response.json());
      expect(result.message).toContain(live.title);
      expect(fixture.events.at(-1)).toMatchObject({
        type,
        requesterId: USER,
        source: {
          kind: "url",
          mode: "video",
          url: "https://v2.streameast.ga/seattle-seahawks-san-francisco-49ers-1/",
        },
      });
      if (placement !== "now")
        expect(fixture.events.at(-1)).not.toHaveProperty("preResolved");
    }
    const response = await fixture.handler(get("/api/player?guildId=" + GUILD));
    const snapshot = SnapshotSchema.parse(await response.json());
    expect(snapshot.queue.every((item) => item.title === live.title)).toBe(
      true,
    );
  });

  test("upcoming games cannot allocate a userbot and selected live games still obey the sports gate", async () => {
    fixture = webFixture();
    const today = await sports();
    const upcoming = today.find((event) => event.status === "scheduled");
    const live = today.find((event) => event.status === "live");
    if (upcoming === undefined || live === undefined)
      throw new Error("Expected live and upcoming events");
    const response = await fixture.handler(
      fixture.command({
        action: "play",
        placement: "queue",
        selection: { kind: "sports", id: upcoming.id },
      }),
    );
    expect(response.status).toBe(409);
    expect(fixture.allocations()).toBe(0);
    expect(() =>
      fixture.catalog.select({ kind: "sports", id: live.id }, "another-viewer"),
    ).toThrow("expired");
    fixture.setSportsEnabled(false);
    const denied = await fixture.handler(
      fixture.command({
        action: "play",
        placement: "queue",
        selection: { kind: "sports", id: live.id },
      }),
    );
    expect(denied.status).toBe(409);
    expect(fixture.events).toHaveLength(0);
  });
});
