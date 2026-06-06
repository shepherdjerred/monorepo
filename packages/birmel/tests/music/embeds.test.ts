import { describe, expect, test } from "bun:test";
import {
  buildNowPlayingEmbed,
  buildPlaylistEmbed,
  buildQueueEmbed,
} from "@shepherdjerred/birmel/music/embeds.ts";

describe("music embeds", () => {
  test("adds cover art to now-playing embeds", () => {
    const embed = buildNowPlayingEmbed(
      {
        title: "Song",
        duration: "3:00",
        url: "https://example.com/song",
        coverUrl: "https://example.com/cover.jpg",
      },
      "0:30 / 3:00",
    );

    expect(embed.title).toBe("Now Playing");
    expect(embed.thumbnail?.url).toBe("https://example.com/cover.jpg");
    expect(embed.fields?.some((field) => field.name === "Progress")).toBe(true);
  });

  test("summarizes queue contents", () => {
    const embed = buildQueueEmbed({
      currentTrack: {
        title: "Current",
        duration: "1:00",
        url: "https://example.com/current",
      },
      tracks: [
        {
          title: "Next",
          duration: "2:00",
          url: "https://example.com/next",
        },
      ],
      totalTracks: 1,
    });

    expect(embed.title).toBe("Music Queue");
    expect(embed.fields?.some((field) => field.name === "Current")).toBe(true);
    expect(embed.fields?.some((field) => field.name === "Up Next")).toBe(true);
  });

  test("summarizes playlist contents", () => {
    const embed = buildPlaylistEmbed({
      name: "mix",
      tracks: [
        {
          title: "Track",
          duration: "2:00",
          url: "https://example.com/track",
        },
      ],
    });

    expect(embed.title).toBe("Playlist: mix");
    expect(embed.fields?.some((field) => field.name === "Count")).toBe(true);
  });
});
