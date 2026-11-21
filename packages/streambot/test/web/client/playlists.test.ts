import { describe, expect, test } from "vitest";
import type {
  PlaylistPageSchema,
  PlaylistSummary,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import {
  copyName,
  entryItem,
  movePosition,
  navigationNotice,
  parsePlaylistsSearch,
  playlistDetail,
  playlistListItem,
  playlistRequest,
  shareUrl,
  isSpotifyLink,
} from "@shepherdjerred/streambot/web/client/playlists/playlist-model.ts";
import type { z } from "zod";

type Page = z.infer<typeof PlaylistPageSchema>;

const summary: PlaylistSummary = {
  id: "p1",
  name: "Evening",
  ownerId: "1",
  guildId: null,
  revision: 4,
  count: 2,
  owned: true,
};
const ITEM = "0b0c7e3e-2c1c-4a63-9c8e-0a3f6f1c9d11";

describe("share and legacy links", () => {
  test("reads the classic share link", () => {
    const params = new URLSearchParams("guild=123&playlist=abc");
    expect(parsePlaylistsSearch(params)).toEqual({
      playlist: "abc",
      guild: "123",
      importUrl: "",
    });
  });

  test("ignores a malformed guild and an empty playlist", () => {
    const params = new URLSearchParams("guild=x&playlist=");
    expect(parsePlaylistsSearch(params)).toEqual({
      playlist: null,
      guild: null,
      importUrl: "",
    });
  });

  test("keeps the import link from a search result", () => {
    const params = new URLSearchParams({
      import: "https://open.spotify.com/playlist/abc",
    });
    expect(parsePlaylistsSearch(params).importUrl).toBe(
      "https://open.spotify.com/playlist/abc",
    );
  });

  test("builds a share link that names the server", () => {
    expect(shareUrl("https://x.test", "123", "a b")).toBe(
      "https://x.test/playlists/a%20b?guild=123",
    );
  });

  test("recognizes a Spotify link", () => {
    expect(isSpotifyLink("https://open.spotify.com/track/1")).toBe(true);
    expect(isSpotifyLink("https://youtube.com/playlist?list=1")).toBe(false);
    expect(isSpotifyLink("nope")).toBe(false);
  });
});

describe("mutation requests", () => {
  test("bind an edit to the revision the viewer saw", () => {
    expect(
      playlistRequest("9", { id: "p1", revision: 4 }, { action: "publish" }),
    ).toEqual({ action: "publish", guildId: "9", id: "p1", revision: 4 });
  });

  test("a create names no playlist", () => {
    expect(
      playlistRequest("9", null, { action: "create", name: "New" }),
    ).toEqual({ action: "create", name: "New", guildId: "9" });
  });

  test("a copy name stays within the server limit", () => {
    expect(copyName("a".repeat(100))).toHaveLength(100);
    expect(copyName("Evening")).toBe("Evening copy");
  });
});

describe("moving items", () => {
  test("up lands one place earlier, down one place later", () => {
    expect(movePosition(3, "up", 10)).toBe(3);
    expect(movePosition(3, "down", 10)).toBe(5);
  });

  test("the first cannot move up and the last cannot move down", () => {
    expect(movePosition(0, "up", 10)).toBeNull();
    expect(movePosition(9, "down", 10)).toBeNull();
  });
});

describe("rows", () => {
  test("a playlist row opens its page and plays whole", () => {
    const item = playlistListItem(summary, true, "9");
    expect(item.href).toBe("/playlists/p1");
    expect(item.selection).toEqual({
      kind: "playlist",
      id: "p1",
      revision: 4,
    });
    expect(item.actions).toEqual(["listen", "watch"]);
  });

  test("a music item listens, other media does both, quiet items do nothing", () => {
    const music = {
      id: ITEM,
      title: "Daft Punk — Get Lucky",
      selectionId: "s1",
      music: {
        provider: "youtube-music" as const,
        id: "m",
        title: "Get Lucky",
        artists: ["Daft Punk"],
        canonicalUrl: "https://music.youtube.com/watch?v=m",
        durationSeconds: 369,
      },
    };
    const song = entryItem(music, "9", true);
    expect(song.title).toBe("Get Lucky");
    expect(song.subtitle).toBe("Daft Punk");
    expect(song.actions).toEqual(["listen"]);
    expect(song.selection).toEqual({ kind: "music", id: "s1" });

    const video = entryItem(
      { id: ITEM, title: "A talk", selectionId: "s2" },
      "9",
      true,
    );
    expect(video.actions).toEqual(["listen", "watch"]);
    expect(
      entryItem({ id: ITEM, title: "A talk", selectionId: "s2" }, "9", false)
        .actions,
    ).toEqual(["watch"]);

    const quiet = entryItem({ id: ITEM, title: "A talk" }, "9", true);
    expect(quiet.actions).toEqual([]);
    expect(quiet.selection).toBeNull();
  });

  test("describes private, shared and others' playlists", () => {
    const base: Page = { ...summary, items: [] };
    expect(playlistDetail(base)).toBe("2 items · Private");
    expect(playlistDetail({ ...base, guildId: "9" })).toBe(
      "2 items · Shared with this server",
    );
    expect(
      playlistDetail({ ...base, guildId: "9", owned: false, count: 1 }),
    ).toBe("1 item · Shared");
  });
});

describe("navigation notice", () => {
  test("reads an import note and ignores anything else", () => {
    expect(navigationNotice({ notice: "2 skipped" })).toBe("2 skipped");
    expect(navigationNotice(null)).toBe("");
    expect(navigationNotice({ other: 1 })).toBe("");
  });
});
