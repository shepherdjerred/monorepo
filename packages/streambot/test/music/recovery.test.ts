import { expect, test, vi } from "vitest";
import {
  harness,
  guildId,
  voiceChannelId,
  statusChannelId,
  userId,
  number,
} from "#numbered-fixture";
import { SONG } from "#music-fixture";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { stateFilePath } from "@shepherdjerred/streambot/state/persistence.ts";
import { loadRoomState } from "@shepherdjerred/streambot/state/room-persistence.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

test("selected YouTube recording, duplicates, and pause position survive a numbered-room restart", async () => {
  const selected = musicSource(
    SONG,
    "https://www.youtube.com/watch?v=h5EofwRzit0",
  );
  const next = musicSource({ ...SONG, title: "Next song" });
  const h = await harness(1, {
    resolveSource: ({ source }) =>
      Promise.resolve({
        title: source.music?.title ?? "Media",
        ffmpegInput: "https://media.invalid/temporary-audio",
        mediaKind: "music",
        chapters: [],
        playbackSource: selected,
      }),
  });
  const handle = h.manager.ensureForPlay({
    guildId,
    voiceChannelId,
    statusChannelId,
    playbackChannel: number(1),
  });
  if (handle === null) throw new Error("Missing fixture session");
  const sources: Source[] = [musicSource(SONG), next, next];
  for (const source of sources)
    handle.dispatch({
      type: "ADD",
      source,
      requesterId: userId,
      queuedAt: 1234,
    });
  await vi.waitFor(() => expect(handle.view().state).toBe("streaming"));
  expect(handle.view().current?.source).toEqual(selected);
  handle.dispatch({ type: "PAUSE", positionSeconds: 42 });
  await vi.waitFor(() => expect(handle.view().paused).toBe(true));
  await h.manager.destroyAll();
  const file = stateFilePath(h.dir, guildId, voiceChannelId);
  const room = await loadRoomState(file, 3600);
  expect(room?.slots[0]?.state.current?.source).toEqual(selected);
  expect(room?.slots[0]?.state.current?.positionSeconds).toBe(42);
  expect(room?.slots[0]?.state.queue.map((item) => item.source)).toEqual([
    next,
    next,
  ]);
  expect(await Bun.file(file).text()).not.toContain("media.invalid");
  const restarted = h.restart();
  await restarted.resumeAll();
  await vi.waitFor(() => {
    const restored = restarted
      .getExisting(guildId, voiceChannelId, number(1))
      ?.view();
    expect(restored?.paused).toBe(true);
    expect(restored?.current?.source).toEqual(selected);
    expect(restored?.queue.map((item) => item.source)).toEqual([next, next]);
  });
});
