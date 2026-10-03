import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RoomPersistence,
  PersistedRoomSchema,
  loadRoomState,
} from "@shepherdjerred/streambot/state/room-persistence.ts";
import {
  saveState,
  stateFilePath,
  type PersistedState,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";

const guildId = GuildIdSchema.parse("100000000000000001");
const channelId = ChannelIdSchema.parse("100000000000000010");
const number = (value: number) => PlaybackChannelNumberSchema.parse(value);
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});
const state = (): PersistedState => ({
  version: 2,
  guildId,
  channelId,
  statusChannelId: channelId,
  savedAt: Date.now(),
  loop: "off",
  volume: 100,
  current: {
    source: { kind: "search", query: "original title", mode: "music" },
    requesterId: UserIdSchema.parse("100000000000000099"),
    title: "Track",
    positionSeconds: 42,
  },
  queue: [],
  resumeAttempts: 0,
  resumeKey: null,
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "streambot-room-state-"));
  dirs.push(dir);
  return {
    dir,
    rooms: new RoomPersistence(dir),
    file: stateFilePath(dir, guildId, channelId),
  };
}

describe("atomic numbered room state", () => {
  test("concurrent sibling checkpoints retain both slots and leave no temporary file", async () => {
    const h = await fixture();
    await Promise.all([
      h.rooms.update(number(1), "audio", state()),
      h.rooms.update(number(2), "video", { ...state(), volume: 75 }),
    ]);
    const saved = await loadRoomState(h.file, 3600);
    expect(saved?.slots.map((slot) => slot.number)).toEqual([1, 2]);
    expect(saved?.slots[1]?.state.volume).toBe(75);
    expect(saved?.slots[0]?.state.current?.source).toEqual({
      kind: "search",
      query: "original title",
      mode: "music",
    });
    const files = await readdir(path.dirname(h.file));
    expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
  });
  test("removing an old instance cannot remove its replacement or a sibling", async () => {
    const h = await fixture();
    await h.rooms.update(number(1), "retired", state());
    await Promise.all([
      h.rooms.update(number(1), "replacement", state()),
      h.rooms.update(number(2), "video", state()),
      h.rooms.remove(guildId, channelId, number(1), "retired"),
    ]);
    const replaced = await loadRoomState(h.file, 3600);
    expect(replaced?.slots.map((slot) => slot.instanceId)).toEqual([
      "replacement",
      "video",
    ]);
    await h.rooms.discard(guildId, channelId, number(1));
    const discarded = await loadRoomState(h.file, 3600);
    expect(discarded?.slots.map((slot) => slot.instanceId)).toEqual(["video"]);
  });
  test("loading an older envelope during reconnect cannot overwrite a pending sibling checkpoint", async () => {
    const h = await fixture();
    await h.rooms.update(number(1), "audio", state());
    const older = await loadRoomState(h.file, 3600);
    if (older === null) throw new Error("Missing fixture snapshot");
    const pending = h.rooms.update(number(2), "video", state());
    await h.rooms.restore(older);
    await pending;
    const current = await loadRoomState(h.file, 3600);
    expect(current?.slots.map((slot) => slot.number)).toEqual([1, 2]);
  });
  test("a retirement before boot restores only untouched siblings and accepts a later replacement checkpoint", async () => {
    const h = await fixture();
    await h.rooms.update(number(1), "audio", state());
    await h.rooms.update(number(2), "old-video", state());
    const saved = await loadRoomState(h.file, 3600);
    if (saved === null) throw new Error("Missing fixture snapshot");
    const restarted = new RoomPersistence(h.dir);
    await restarted.discard(guildId, channelId, number(2));
    await restarted.restore(saved);
    const retired = await loadRoomState(h.file, 3600);
    expect(retired?.slots.map((slot) => slot.instanceId)).toEqual(["audio"]);
    await restarted.update(number(2), "replacement-video", state());
    await restarted.restore(saved);
    const replaced = await loadRoomState(h.file, 3600);
    expect(replaced?.slots.map((slot) => slot.instanceId)).toEqual([
      "audio",
      "replacement-video",
    ]);
  });
  test("legacy v2 snapshots remain available to the legacy resume path", async () => {
    const h = await fixture();
    await saveState(h.file, state());
    expect(await loadRoomState(h.file, 3600)).toBeNull();
    expect(await Bun.file(h.file).exists()).toBe(true);
  });
  test("corrupt room identities and duplicate slots fail validation", async () => {
    const h = await fixture();
    await h.rooms.update(number(1), "audio", state());
    const saved = await loadRoomState(h.file, 3600);
    if (saved?.slots[0] === undefined)
      throw new Error("Missing fixture snapshot");
    expect(
      PersistedRoomSchema.safeParse({
        ...saved,
        slots: [saved.slots[0], saved.slots[0]],
      }).success,
    ).toBe(false);
    expect(
      PersistedRoomSchema.safeParse({
        ...saved,
        channelId: "100000000000000011",
      }).success,
    ).toBe(false);
  });
});
