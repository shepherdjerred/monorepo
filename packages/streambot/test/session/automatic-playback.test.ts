import { expect, test, vi } from "vitest";
import {
  harness,
  scope,
  statusChannelId,
  userId,
  guildId,
  voiceChannelId,
  number,
} from "#numbered-fixture";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

async function automaticRoom() {
  return await harness(2, {
    library: () => [
      {
        title: "Movie",
        path: "/movie.mkv",
        relativePath: "movie.mkv",
        library: "movies",
      },
    ],
    resolvePlaySource: (source) =>
      Promise.resolve({
        title: "Track",
        chapters: [],
        ffmpegInput: "fixture",
        mediaKind:
          source.kind === "url" && source.url.includes("song")
            ? "music"
            : "video",
      }),
    featureGate: {
      assistantV2: () => Promise.resolve(true),
      history: () => Promise.resolve(false),
      musicOverVoice: () => Promise.resolve(true),
      numberedChannels: () => Promise.resolve(true),
      automaticChannelRouting: () => Promise.resolve(true),
      sportsStreaming: () => Promise.resolve(true),
    },
  });
}
function play(service: PlaybackCommandService, source: Source) {
  return service.play({
    query: "Media",
    source: "auto",
    placement: "queue",
    userId,
    sourceOverride: source,
    spoken: false,
  });
}

test("shared slash/voice command dependencies route music to 1, local files and sports to 2, and honor manual selection", async () => {
  const room = await automaticRoom();
  let service = new PlaybackCommandService(
    await room.manager.numbered.commandDeps(scope, statusChannelId),
  );
  await play(service, { kind: "url", url: "https://example.com/song" });
  await play(service, { kind: "file", path: "/movie.mkv", title: "Movie" });
  await play(service, { kind: "url", url: "https://v2.streameast.ga/game/" });
  expect(room.manager.numbered.selection.isManual(scope)).toBe(false);
  expect(room.manager.numbered.selection.get(scope)).toBe(2);
  await vi.waitFor(() => {
    expect(room.plays.map((item) => item.transport)).toEqual([
      "music",
      "video",
    ]);
  });
  expect(
    room.manager.getExisting(guildId, voiceChannelId, number(2))?.view()
      .queue[0]?.source,
  ).toMatchObject({ kind: "url", url: "https://v2.streameast.ga/game/" });
  room.manager.numbered.selection.select(scope, 3, 3);
  service = new PlaybackCommandService(
    await room.manager.numbered.commandDeps(scope, statusChannelId),
  );
  await play(service, { kind: "url", url: "https://example.com/song" });
  expect(
    room.manager.getExisting(guildId, voiceChannelId, number(3))?.view().current
      ?.source?.mode,
  ).toBe("video");
  expect(room.manager.numbered.selection.get(scope)).toBe(3);
});

test("a changed personal selection or destination revision during resolution cannot dispatch", async () => {
  const room = await automaticRoom();
  const deps = await room.manager.numbered.commandDeps(scope, statusChannelId);
  const resolve = vi.fn(deps.resolvePlaySource);
  resolve.mockImplementation(async (source, signal) => {
    room.manager.numbered.selection.select(scope, 2, 3);
    return await deps.resolvePlaySource(source, signal);
  });
  await expect(
    play(new PlaybackCommandService({ ...deps, resolvePlaySource: resolve }), {
      kind: "url",
      url: "https://example.com/song",
    }),
  ).rejects.toThrow("selection changed");
  expect(room.entries.every((entry) => !entry.busy)).toBe(true);
  room.manager.numbered.selection.clear(scope);
  const next = await room.manager.numbered.commandDeps(scope, statusChannelId);
  await expect(
    play(
      new PlaybackCommandService({
        ...next,
        resolvePlaySource: async (source, signal) => {
          room.play(2);
          return await next.resolvePlaySource(source, signal);
        },
      }),
      { kind: "url", url: "https://example.com/video" },
    ),
  ).rejects.toThrow("Playback changed");
});
