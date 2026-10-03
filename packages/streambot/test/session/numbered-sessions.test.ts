import { describe, expect, test, vi } from "vitest";
import { loadRoomState } from "@shepherdjerred/streambot/state/room-persistence.ts";
import { stateFilePath } from "@shepherdjerred/streambot/state/persistence.ts";
import {
  harness,
  guildId,
  voiceChannelId,
  otherChannel,
  statusChannelId,
  scope,
  number,
} from "./numbered-fixture.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";

function account(handle: SessionHandle): string {
  const id = handle.assistantUserId();
  if (id === null) throw new Error("Missing fixture identity");
  return id;
}

async function expectPrimarySlotsStopped(
  manager: SessionManager,
): Promise<void> {
  await vi.waitFor(() => {
    for (const slot of [1, 2]) {
      expect(
        manager.getExisting(guildId, voiceChannelId, number(slot)),
      ).toBeNull();
    }
  });
}

describe("numbered playback ownership", () => {
  test("1+2 share one account, 3 uses another, and another room leases a distinct account", async () => {
    const h = await harness();
    const mic = h.play(1);
    const video = h.play(2);
    h.play(3);
    h.play(2, otherChannel);
    await vi.waitFor(() => expect(h.plays).toHaveLength(4));
    expect(mic.assistantUserId()).toBe(video.assistantUserId());
    expect(h.joins).toHaveBeenCalledTimes(3);
    expect(
      h.plays
        .slice(0, 2)
        .map((play) => play.transport)
        .sort(),
    ).toEqual(["music", "video"]);
    mic.dispatch({ type: "STOP" });
    await vi.waitFor(() =>
      expect(
        h.manager.getExisting(guildId, voiceChannelId, number(1)),
      ).toBeNull(),
    );
    expect(video.view().state).toBe("streaming");
    expect(h.disconnects).not.toHaveBeenCalled();
    video.dispatch({ type: "STOP" });
    await vi.waitFor(() => expect(h.disconnects).toHaveBeenCalledTimes(1));
  });
  test("selection is personal, defaults to 1, allocates nothing, and resets on leaving", async () => {
    const h = await harness(2);
    expect(await h.manager.selectedChannel(scope)).toBe(1);
    expect(await h.manager.numbered.select(scope, 2)).toContain(
      "channel 2 · Video",
    );
    expect(
      await h.manager.selectedChannel({ ...scope, userId: "another-speaker" }),
    ).toBe(1);
    expect(h.entries.some((entry) => entry.busy)).toBe(false);
    expect(await h.manager.numbered.select(scope, 4)).toContain("from 1 to 3");
    h.manager.numbered.selection.clear(scope);
    expect(await h.manager.selectedChannel(scope)).toBe(1);
  });
  test("channel discovery stays within Discord's message limit and shows the selected page", async () => {
    const h = await harness(24);
    await h.manager.numbered.select(scope, 21);
    const selected = await h.manager.numbered.list(scope);
    expect(selected).toContain("page 3/3");
    expect(selected).toContain("→ channel 21");
    expect(selected.length).toBeLessThanOrEqual(2000);
    expect(await h.manager.numbered.list(scope, 1)).toContain(
      "channel 1 · Audio",
    );
    expect(h.entries.some((entry) => entry.busy)).toBe(false);
  });

  test("a retired card cannot address a new instance of the same slot; unused sibling releases safely", async () => {
    const h = await harness(1);
    const first = h.play(2);
    await vi.waitFor(() => expect(first.view().state).toBe("streaming"));
    const unused = h.manager.ensureForPlay({
      guildId,
      voiceChannelId,
      statusChannelId,
      playbackChannel: number(1),
    });
    expect(unused?.assistantUserId()).toBe(first.assistantUserId());
    h.manager.releaseUnused(guildId, voiceChannelId, number(1));
    expect(h.disconnects).not.toHaveBeenCalled();
    first.dispatch({ type: "STOP" });
    await vi.waitFor(() => expect(h.entries[0]?.busy).toBe(false));
    const second = h.play(2);
    expect(second.instanceId).not.toBe(first.instanceId);
    expect(
      h.manager.getExisting(
        guildId,
        voiceChannelId,
        number(2),
        first.instanceId,
      ),
    ).toBeNull();
  });
  test("one atomic room snapshot restores paused audio and video on the same account", async () => {
    const h = await harness(1);
    const mic = h.play(1);
    const video = h.play(2);
    await vi.waitFor(() => expect(video.view().state).toBe("streaming"));
    mic.dispatch({ type: "PAUSE", positionSeconds: 42 });
    await vi.waitFor(() => expect(mic.view().paused).toBe(true));
    await h.manager.destroyAll();
    const room = await loadRoomState(
      stateFilePath(h.dir, guildId, voiceChannelId),
      3600,
    );
    expect(room?.slots.map((slot) => slot.number)).toEqual([1, 2]);
    expect(room?.slots[0]?.state.paused).toBe(true);
    expect(room?.slots[0]?.state.current?.positionSeconds).toBe(42);
    expect(h.entries.every((entry) => !entry.busy)).toBe(true);
    const restarted = h.restart();
    await restarted.resumeAll();
    expect(
      restarted
        .getExisting(guildId, voiceChannelId, number(1))
        ?.assistantUserId(),
    ).toBe(
      restarted
        .getExisting(guildId, voiceChannelId, number(2))
        ?.assistantUserId(),
    );
    await vi.waitFor(() =>
      expect(
        restarted.getExisting(guildId, voiceChannelId, number(1))?.view()
          .paused,
      ).toBe(true),
    );
  });

  test.each([1, 2])(
    "stopping resumed channel %i before its first checkpoint retires its persisted slot",
    async (stopped) => {
      const h = await harness(1);
      h.play(1);
      const video = h.play(2);
      await vi.waitFor(() => expect(video.view().state).toBe("streaming"));
      await h.manager.destroyAll();
      const restarted = h.restart();
      await restarted.resumeAll();
      const resumed = restarted.getExisting(
        guildId,
        voiceChannelId,
        number(stopped),
      );
      if (resumed === null) throw new Error("Missing resumed fixture slot");
      resumed.dispatch({ type: "STOP" });
      const survivor = stopped === 1 ? 2 : 1;
      await vi.waitFor(async () => {
        const room = await loadRoomState(
          stateFilePath(h.dir, guildId, voiceChannelId),
          3600,
        );
        expect(room?.slots.map((slot) => slot.number)).toEqual([survivor]);
      });
      await restarted.destroyAll();
      const nextRestart = h.restart();
      await nextRestart.resumeAll();
      expect(
        nextRestart.getExisting(guildId, voiceChannelId, number(stopped)),
      ).toBeNull();
      expect(
        nextRestart.getExisting(guildId, voiceChannelId, number(survivor)),
      ).not.toBeNull();
    },
  );
});

describe("numbered capacity, moves, and connection loss", () => {
  test("shutdown waits for a stopped slot's physical disconnect before releasing its account", async () => {
    const h = await harness(1);
    const video = h.play(2);
    await vi.waitFor(() => expect(video.view().state).toBe("streaming"));
    const entry = h.entries[0];
    if (entry === undefined) throw new Error("Missing fixture account");
    let finishDisconnect: () => void = () => {
      throw new Error("Disconnect has not started");
    };
    entry.userbot.leaveVoice = () =>
      new Promise<void>((resolve) => {
        finishDisconnect = resolve;
      });
    video.dispatch({ type: "STOP" });
    await vi.waitFor(() =>
      expect(
        h.manager.getExisting(guildId, voiceChannelId, number(2)),
      ).toBeNull(),
    );
    let stopped = false;
    const shutdown = (async () => {
      await h.manager.destroyAll();
      stopped = true;
    })();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(false);
    expect(entry.busy).toBe(true);
    finishDisconnect();
    await shutdown;
    expect(entry.busy).toBe(false);
    expect(() =>
      h.manager.ensureForPlay({
        guildId,
        voiceChannelId,
        statusChannelId,
        playbackChannel: number(1),
      }),
    ).toThrow("shutting down");
  });

  test("pool exhaustion preserves existing slots and still permits the primary sibling", async () => {
    const h = await harness(1);
    const video = h.play(2);
    const unavailable = (value: number, channel = voiceChannelId) =>
      h.manager.ensureForPlay({
        guildId,
        voiceChannelId: channel,
        statusChannelId,
        playbackChannel: number(value),
      });
    expect(unavailable(3)).toBeNull();
    expect(unavailable(2, otherChannel)).toBeNull();
    expect(unavailable(1)?.assistantUserId()).toBe(video.assistantUserId());
    await vi.waitFor(() => expect(video.view().state).toBe("streaming"));
    expect(h.joins).toHaveBeenCalledTimes(1);
  });

  test("moving an account transfers 1+2 together and leaves helper video in the original room", async () => {
    const h = await harness(2);
    const mic = h.play(1);
    const video = h.play(2);
    const helper = h.play(3);
    await vi.waitFor(() => expect(h.plays).toHaveLength(3));
    expect(
      h.manager.moveSession({
        guildId,
        fromChannelId: voiceChannelId,
        toChannelId: otherChannel,
        userId: account(mic),
      }),
    ).toBe(true);
    expect(
      h.manager.getExisting(guildId, voiceChannelId, number(1)),
    ).toBeNull();
    expect(
      h.manager.getExisting(guildId, otherChannel, number(1))?.instanceId,
    ).toBe(mic.instanceId);
    expect(
      h.manager.getExisting(guildId, otherChannel, number(2))?.instanceId,
    ).toBe(video.instanceId);
    expect(
      h.manager.getExisting(guildId, voiceChannelId, number(3))?.instanceId,
    ).toBe(helper.instanceId);
    await vi.waitFor(async () => {
      const room = await loadRoomState(
        stateFilePath(h.dir, guildId, otherChannel),
        3600,
      );
      expect(room?.slots.map((slot) => slot.number)).toEqual([1, 2]);
    });
  });

  test("a move collision stops the moved account's slots and preserves both rooms' other playback", async () => {
    const h = await harness(3);
    const mic = h.play(1);
    h.play(2);
    const helper = h.play(3);
    const destination = h.play(2, otherChannel);
    await vi.waitFor(() => expect(h.plays).toHaveLength(4));
    expect(
      h.manager.moveSession({
        guildId,
        fromChannelId: voiceChannelId,
        toChannelId: otherChannel,
        userId: account(mic),
      }),
    ).toBe(false);
    await vi.waitFor(() =>
      expect(
        h.manager.getExisting(guildId, voiceChannelId, number(2)),
      ).toBeNull(),
    );
    expect(helper.view().state).toBe("streaming");
    expect(destination.view().state).toBe("streaming");
    expect(
      h.manager.getExisting(guildId, otherChannel, number(2))?.instanceId,
    ).toBe(destination.instanceId);
  });

  test("an ordinary voice removal stops both primary slots and preserves helper video", async () => {
    const h = await harness(2);
    const mic = h.play(1);
    h.play(2);
    const helper = h.play(3);
    await vi.waitFor(() => expect(h.plays).toHaveLength(3));
    const close = h.closeListeners.get(account(mic));
    if (close == null) throw new Error("Missing physical close listener");
    close({ code: 4014, deliberate: true, atMs: Date.now(), source: "voice" });
    await expectPrimarySlotsStopped(h.manager);
    expect(helper.view().state).toBe("streaming");
    expect(h.disconnects).toHaveBeenCalledTimes(1);
  });

  test("a Go Live close recovers or stops video while mic audio remains connected", async () => {
    const h = await harness(1);
    const mic = h.play(1);
    const video = h.play(2);
    await vi.waitFor(() => expect(h.plays).toHaveLength(2));
    const close = h.closeListeners.get(account(mic));
    if (close == null) throw new Error("Missing physical close listener");
    close({
      code: 4015,
      deliberate: false,
      atMs: Date.now(),
      source: "go-live",
    });
    await vi.waitFor(() => expect(h.plays).toHaveLength(3));
    expect(mic.view().state).toBe("streaming");
    expect(h.disconnects).not.toHaveBeenCalled();
    close({
      code: 4014,
      deliberate: true,
      atMs: Date.now(),
      source: "go-live",
    });
    await vi.waitFor(() =>
      expect(
        h.manager.getExisting(guildId, voiceChannelId, number(2)),
      ).toBeNull(),
    );
    expect(mic.view().state).toBe("streaming");
    expect(h.disconnects).not.toHaveBeenCalled();
    close({ code: 4014, deliberate: true, atMs: Date.now(), source: "voice" });
    await expectPrimarySlotsStopped(h.manager);
    expect(video.view().queue).toHaveLength(0);
  });
});
