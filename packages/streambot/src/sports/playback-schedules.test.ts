import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LolPlaybackSchedules,
  type SchedulePorts,
} from "./playback-schedules.ts";
import { lolSportsEvent } from "./lolesports.ts";
import { lolMatch } from "#lol-fixture";
import type { ScheduleTarget } from "./schedule-types.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
const stores: LolPlaybackSchedules[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const target: ScheduleTarget = {
  guildId: "1",
  channelId: "2",
  channelName: "Movie night",
  statusChannelId: "2",
  userId: "3",
  slot: 2,
};
function fixture() {
  let match = lolMatch();
  let slot: ReturnType<SchedulePorts["slot"]> = { idle: true };
  const ports: SchedulePorts = {
    allowed: vi.fn(async () => true),
    authority: vi.fn(async () => ({ allowed: true, listeners: true })),
    slot: () => slot,
    start: vi.fn(async (schedule, _signal, claim) => {
      if (!claim()) return "busy";
      slot = { idle: false, scheduleId: schedule.id };
      return "started";
    }),
    stop: vi.fn(() => {
      slot = { idle: true };
    }),
  };
  const store = new LolPlaybackSchedules(
    ":memory:",
    { find: async () => match },
    ports,
  );
  stores.push(store);
  const signal = AbortSignal.timeout(3000);
  return {
    store,
    ports,
    signal,
    create: () => store.create(lolSportsEvent(match), target, signal),
    setMatch: (value: typeof match) => {
      match = value;
    },
    setSlot: (value: typeof slot) => {
      slot = value;
    },
  };
}
describe("one-time LoL automatic playback", () => {
  it("retains schedules and playback ownership across database reopen without a second start", async () => {
    const f = fixture();
    const match = lolMatch();
    const directory = await mkdtemp(
      path.join(tmpdir(), "streambot-lol-schedules-"),
    );
    const file = path.join(directory, "schedules.sqlite");
    let store: LolPlaybackSchedules | undefined;
    const open = () =>
      new LolPlaybackSchedules(file, { find: async () => match }, f.ports);
    try {
      store = open();
      const created = await store.create(
        lolSportsEvent(match),
        target,
        f.signal,
      );
      store.close();
      store = undefined;
      store = open();
      expect(store.list("1", "3")[0]?.id).toBe(created.id);
      match.state = "inProgress";
      await store.reconcile(f.signal);
      store.close();
      store = undefined;
      store = open();
      await store.reconcile(f.signal);
      expect(f.ports.start).toHaveBeenCalledTimes(1);
      expect(store.list("1", "3")[0]?.status).toBe("playing");
      f.setSlot({ idle: true });
      await store.reconcile(f.signal);
      await store.reconcile(f.signal);
      expect(store.list("1", "3")[0]?.status).toBe("stopped");
      expect(f.ports.start).toHaveBeenCalledTimes(1);
    } finally {
      store?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("deduplicates schedules and rejects different owners and invalid targets", async () => {
    const f = fixture();
    const first = await f.create();
    const duplicate = await f.create();
    expect(duplicate.id).toBe(first.id);
    await expect(
      f.store.create(first.event, { ...target, userId: "4" }, f.signal),
    ).rejects.toThrow("already scheduled");
    await expect(
      f.store.create(first.event, { ...target, slot: 1 }, f.signal),
    ).rejects.toThrow(PlaybackCommandBoundaryError);
    await expect(
      f.store.create(first.event, { ...target, slot: 1 }, f.signal),
    ).rejects.toThrow("Choose channel 2 or higher");
  });
  it("lets an explicit new request replace a cancelled reservation while retaining history", async () => {
    const f = fixture();
    const first = await f.create();
    f.store.cancel(first.id, "1", "3");
    const second = await f.create();
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("pending");
    f.store.cancel(second.id, "1", "3");
    const third = await f.store.create(
      second.event,
      { ...target, userId: "4" },
      f.signal,
    );
    expect(third.id).not.toBe(second.id);
    expect(third.status).toBe("pending");
    expect(f.store.list("1", "3").map((s) => s.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
  });
  it("allows explicit retry of a failed future reservation after flags are restored", async () => {
    const f = fixture();
    const first = await f.create();
    f.ports.allowed = async () => false;
    await f.store.reconcile(f.signal);
    expect(f.store.list("1", "3")[0]?.status).toBe("failed");
    f.ports.allowed = async () => true;
    const second = await f.create();
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("pending");
  });
  it("follows changed start times and waits for listeners and an idle slot", async () => {
    const f = fixture();
    await f.create();
    f.setMatch({ ...lolMatch(), startTime: "2026-10-27T17:00:00Z" });
    await f.store.reconcile(f.signal);
    expect(f.store.list("1", "3")[0]?.startsAt).toBe("2026-10-27T17:00:00Z");
    f.setMatch({ ...lolMatch(), state: "inProgress" });
    f.ports.authority = async () => ({ allowed: true, listeners: false });
    await f.store.reconcile(f.signal);
    expect(f.store.list("1", "3")[0]?.reason).toBe("listeners");
    f.ports.authority = async () => ({ allowed: true, listeners: true });
    f.setSlot({ idle: false });
    await f.store.reconcile(f.signal);
    expect(f.ports.start).not.toHaveBeenCalled();
    f.setSlot({ idle: true });
    await f.store.reconcile(f.signal);
    await f.store.reconcile(f.signal);
    expect(f.ports.start).toHaveBeenCalledTimes(1);
  });
  it("stops at series completion without affecting replacement playback", async () => {
    const f = fixture();
    await f.create();
    f.setMatch({ ...lolMatch(), state: "inProgress" });
    await f.store.reconcile(f.signal);
    f.setMatch({ ...lolMatch(), state: "completed" });
    await f.store.reconcile(f.signal);
    expect(f.ports.stop).toHaveBeenCalledTimes(1);
    expect(f.store.list("1", "3")[0]?.status).toBe("completed");
    const g = fixture();
    await g.create();
    g.setMatch({ ...lolMatch(), state: "inProgress" });
    await g.store.reconcile(g.signal);
    g.setSlot({ idle: false, scheduleId: crypto.randomUUID() });
    g.setMatch({ ...lolMatch(), state: "completed" });
    await g.store.reconcile(g.signal);
    expect(g.ports.stop).not.toHaveBeenCalled();
    expect(g.store.list("1", "3")[0]?.status).toBe("stopped");
  });
  it("never restarts cancelled, manually stopped, or ambiguous dispatches", async () => {
    const f = fixture();
    const s = await f.create();
    f.store.cancel(s.id, "1", "3");
    f.setMatch({ ...lolMatch(), state: "inProgress" });
    await f.store.reconcile(f.signal);
    expect(f.ports.start).not.toHaveBeenCalled();
    const g = fixture();
    await g.create();
    g.setMatch({ ...lolMatch(), state: "inProgress" });
    g.ports.start = async (_s, _signal, claim) => {
      claim();
      throw new Error("lost dispatch");
    };
    await expect(g.store.reconcile(g.signal)).rejects.toThrow("lost dispatch");
    await g.store.reconcile(g.signal);
    expect(g.store.list("1", "3")[0]).toMatchObject({
      status: "failed",
      reason: "ambiguous",
    });
  });
  it("rejects revoked permissions and disabled flags before allocating playback", async () => {
    const f = fixture();
    await f.create();
    f.ports.allowed = async () => false;
    f.setMatch({ ...lolMatch(), state: "inProgress" });
    await f.store.reconcile(f.signal);
    expect(f.ports.start).not.toHaveBeenCalled();
    expect(f.store.list("1", "3")[0]?.reason).toBe("disabled");
    const g = fixture();
    await g.create();
    g.ports.authority = async () => ({ allowed: false, listeners: true });
    await g.store.reconcile(g.signal);
    expect(g.store.list("1", "3")[0]?.reason).toBe("permission");
  });
});
