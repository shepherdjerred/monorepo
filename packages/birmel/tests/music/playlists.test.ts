import { beforeEach, describe, expect, test } from "bun:test";
import {
  addTrackToPlaylist,
  clearAllPlaylistsForTests,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  movePlaylistTrack,
  removeTrackFromPlaylist,
  renamePlaylist,
  replacePlaylistTracks,
  shuffledTracks,
} from "@shepherdjerred/birmel/music/playlists.ts";
import type { MusicTrackInfo } from "@shepherdjerred/birmel/music/metadata.ts";

const trackOne: MusicTrackInfo = {
  title: "One",
  duration: "1:00",
  url: "https://example.com/one",
};

const trackTwo: MusicTrackInfo = {
  title: "Two",
  duration: "2:00",
  url: "https://example.com/two",
};

describe("in-memory music playlists", () => {
  beforeEach(() => {
    clearAllPlaylistsForTests();
  });

  test("keeps playlists scoped per guild", () => {
    expect(createPlaylist("guild-a", "mix").ok).toBe(true);
    expect(createPlaylist("guild-b", "mix").ok).toBe(true);

    expect(listPlaylists("guild-a")).toEqual([{ name: "mix", trackCount: 0 }]);
    expect(listPlaylists("guild-b")).toEqual([{ name: "mix", trackCount: 0 }]);
  });

  test("adds, removes, and moves tracks", () => {
    createPlaylist("guild-a", "mix");
    addTrackToPlaylist("guild-a", "mix", trackOne);
    addTrackToPlaylist("guild-a", "mix", trackTwo);

    const moved = movePlaylistTrack("guild-a", "mix", 2, 1);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.tracks.map((track) => track.title)).toEqual([
        "Two",
        "One",
      ]);
    }

    const removed = removeTrackFromPlaylist("guild-a", "mix", 2);
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.value.tracks.map((track) => track.title)).toEqual(["Two"]);
    }
  });

  test("renames, replaces, and deletes playlists", () => {
    createPlaylist("guild-a", "mix");
    const renamed = renamePlaylist("guild-a", "mix", "new mix");
    expect(renamed.ok).toBe(true);

    const replaced = replacePlaylistTracks("guild-a", "new mix", [
      trackOne,
      trackTwo,
    ]);
    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(replaced.value.tracks).toHaveLength(2);
    }

    const fetched = getPlaylist("guild-a", "new mix");
    expect(fetched.ok).toBe(true);
    const deleted = deletePlaylist("guild-a", "new mix");
    expect(deleted.ok).toBe(true);
    expect(listPlaylists("guild-a")).toEqual([]);
  });

  test("returns shuffled copies without mutating the original tracks", () => {
    const original = [trackOne, trackTwo];
    const shuffled = shuffledTracks(original);

    expect(shuffled).toHaveLength(2);
    expect(original.map((track) => track.title)).toEqual(["One", "Two"]);
    expect(new Set(shuffled.map((track) => track.title))).toEqual(
      new Set(["One", "Two"]),
    );
  });
});
