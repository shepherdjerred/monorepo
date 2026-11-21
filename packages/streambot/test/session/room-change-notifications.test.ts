import { describe, expect, test, vi } from "vitest";
import {
  guildId,
  harness,
  otherChannel,
  scope,
  statusChannelId,
  userId,
  voiceChannelId,
} from "#numbered-fixture";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { RoomChange } from "@shepherdjerred/streambot/session/room-change-hub.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { stateFilePath } from "@shepherdjerred/streambot/state/persistence.ts";
import { loadRoomState } from "@shepherdjerred/streambot/state/room-persistence.ts";

const CHAPTERS = [
  { index: 1, title: "Intro", startSeconds: 0, endSeconds: 90 },
  { index: 2, title: "Middle", startSeconds: 90, endSeconds: 300 },
];

/** Every room change the manager publishes from now on. */
function record(manager: SessionManager): RoomChange[] {
  const changes: RoomChange[] = [];
  manager.changes.subscribe((change) => {
    changes.push(change);
  });
  return changes;
}

const roomOf = (channelId: typeof voiceChannelId): RoomChange => ({
  guildId,
  channelId,
  userId: null,
});

/** A room whose accounts accept or refuse seeks as `seeks.applied` says, and whose media has chapters. */
async function seekableRoom() {
  const seeks = { applied: true };
  const resolved: ResolvedSource = {
    title: "Clip",
    ffmpegInput: "/clip",
    mediaKind: "video",
    chapters: CHAPTERS,
    durationSeconds: 300,
  };
  const room = await harness(2, {
    resolveSource: () => Promise.resolve(resolved),
    resolvePlaySource: () => Promise.resolve(resolved),
    library: () => [],
  });
  const seekable = (lane: StreamerLike): StreamerLike => {
    lane.seek = () => Promise.resolve(seeks.applied);
    return lane;
  };
  for (const entry of room.entries) {
    const make = entry.userbot.createPlaybackHandle?.bind(entry.userbot);
    seekable(entry.userbot);
    if (make !== undefined)
      entry.userbot.createPlaybackHandle = (transport) =>
        seekable(make(transport));
  }
  return { room, seeks };
}

describe("room changes without an actor event", () => {
  test("a successful seek tells viewers of the room and a refused one does not", async () => {
    const { room, seeks } = await seekableRoom();
    const handle = room.play(2);
    await vi.waitFor(() => expect(handle.view().state).toBe("streaming"));
    const changes = record(room.manager);

    expect(await handle.seek(120)).toBe(true);
    expect(changes).toEqual([roomOf(voiceChannelId)]);

    changes.length = 0;
    seeks.applied = false;
    expect(await handle.seek(30)).toBe(false);
    expect(changes).toEqual([]);
  });

  test("a chapter jump tells viewers of the room", async () => {
    const { room } = await seekableRoom();
    const handle = room.play(2);
    await vi.waitFor(() => expect(handle.view().state).toBe("streaming"));
    room.manager.numbered.selection.select(scope, 2, 3);
    const service = new PlaybackCommandService(
      await room.manager.numbered.commandDeps(scope, statusChannelId),
    );
    const changes = record(room.manager);

    await expect(service.jumpToChapter(userId, 2)).resolves.toMatchObject({
      outcome: "chapter-jumped",
    });
    expect(changes).toEqual([roomOf(voiceChannelId)]);
  });
});

describe("a moved session", () => {
  test("a moved account tells viewers of the room it left as well as the one it entered", async () => {
    const room = await harness(2);
    const mic = room.play(1);
    await vi.waitFor(() => expect(mic.view().state).toBe("streaming"));
    const changes = record(room.manager);

    expect(
      room.manager.moveSession({
        guildId,
        fromChannelId: voiceChannelId,
        toChannelId: otherChannel,
        userId: mic.assistantUserId() ?? "missing-fixture-account",
      }),
    ).toBe(true);
    expect(changes).toContainEqual(roomOf(voiceChannelId));
    expect(changes).toContainEqual(roomOf(otherChannel));
    // Let the moved room file land before the fixture removes its directory.
    await vi.waitFor(async () => {
      const moved = await loadRoomState(
        stateFilePath(room.dir, guildId, otherChannel),
        3600,
      );
      expect(moved?.slots.map((slot) => slot.number)).toEqual([1]);
    });
  });

  test("a moved unnumbered session tells viewers of both rooms", async () => {
    const room = await harness(1);
    const handle = room.manager.ensureForPlay({
      guildId,
      voiceChannelId,
      statusChannelId,
    });
    if (handle === null) throw new Error("No fixture account available");
    handle.dispatch({
      type: "ADD",
      requesterId: userId,
      source: { kind: "search", query: "clip", mode: "video" },
    });
    await vi.waitFor(() => expect(handle.view().state).toBe("streaming"));
    const changes = record(room.manager);

    expect(
      room.manager.moveSession({
        guildId,
        fromChannelId: voiceChannelId,
        toChannelId: otherChannel,
      }),
    ).toBe(true);
    expect(room.manager.getExisting(guildId, otherChannel)).not.toBeNull();
    expect(changes).toContainEqual(roomOf(voiceChannelId));
    expect(changes).toContainEqual(roomOf(otherChannel));
    // Let the resume file follow the move before the fixture removes its directory.
    const path = (channel: typeof voiceChannelId) =>
      stateFilePath(room.dir, guildId, channel);
    await vi.waitFor(async () => {
      expect(await Bun.file(path(voiceChannelId)).exists()).toBe(false);
      expect(await Bun.file(path(otherChannel)).exists()).toBe(true);
    });
  });
});
