import { expect, test, vi } from "vitest";
import { scheduledPlaybackPorts } from "@shepherdjerred/streambot/session/scheduled-playback.ts";
import {
  EMPTY_HANDLE,
  IDLE_VIEW,
} from "@shepherdjerred/streambot/session/session-types.ts";
import type {
  PlaybackView,
  QueueItemView,
} from "@shepherdjerred/streambot/machine/view.ts";
import type { ScheduleTarget } from "./schedule-types.ts";
import { LolPlaybackSchedules } from "./playback-schedules.ts";
import { lolSportsEvent } from "./lolesports.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { lolMatch } from "#lol-fixture";

const target: ScheduleTarget = {
  guildId: "100000000000000001",
  channelId: "100000000000000002",
  userId: "100000000000000003",
  channelName: "Movie night",
  statusChannelId: "100000000000000002",
  slot: 2,
};
function fixture(initial: PlaybackView) {
  let view = initial;
  const dispatch = vi.fn();
  const handle = { ...EMPTY_HANDLE, view: () => view, dispatch };
  const ports = scheduledPlaybackPorts({
    sessions: {
      getExisting: () => handle,
      ensureForPlay: () => handle,
      releaseUnused: vi.fn(),
    },
    allowed: async () => true,
    authority: async () => ({ allowed: true, listeners: true }),
    resolve: async () => ({
      title: "Live series",
      ffmpegInput: "fixture",
      mediaKind: "video",
      chapters: [],
    }),
  });
  return {
    ports,
    dispatch,
    setView: (value: PlaybackView) => {
      view = value;
    },
  };
}
function item(scheduleId?: string): QueueItemView {
  return {
    title: "Queued media",
    requesterId: UserIdSchema.parse(target.userId),
    chapters: [],
    kind: "url",
    mediaKind: "video",
    durationSeconds: null,
    sourceId: "fixture",
    source: {
      kind: "url",
      url: "https://www.youtube.com/watch?v=5fD8Ker-Bic",
      ...(scheduleId === undefined ? {} : { scheduleId }),
    },
  };
}

test.each(["idle", "waiting", "joining", "resolving", "advance", "leaving"])(
  "only empty idle or connected waiting slots are available (%s)",
  (state) => {
    const f = fixture({ ...IDLE_VIEW, state });
    expect(f.ports.slot(target).idle).toBe(
      state === "idle" || state === "waiting",
    );
  },
);
test("a live scheduled series starts in an empty connected waiting slot", async () => {
  const f = fixture({ ...IDLE_VIEW, state: "waiting" });
  const match = lolMatch();
  const store = new LolPlaybackSchedules(
    ":memory:",
    { find: async () => match },
    f.ports,
  );
  try {
    const signal = AbortSignal.timeout(1000);
    const schedule = await store.create(lolSportsEvent(match), target, signal);
    match.state = "inProgress";
    await store.reconcile(signal);
    expect(f.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PLAY_NOW",
        source: expect.objectContaining({ scheduleId: schedule.id }),
      }),
    );
    expect(store.list(target.guildId, target.userId)[0]?.status).toBe(
      "playing",
    );
  } finally {
    store.close();
  }
});
test("a waiting slot with current or queued media remains busy", () => {
  const queued = item();
  const f = fixture({ ...IDLE_VIEW, state: "waiting", queue: [queued] });
  expect(f.ports.slot(target).idle).toBe(false);
  f.setView({ ...IDLE_VIEW, state: "waiting", current: queued });
  expect(f.ports.slot(target).idle).toBe(false);
});
test("stopping an owned series skips or removes only its item and preserves unrelated queued media", async () => {
  const f = fixture(IDLE_VIEW);
  const match = lolMatch();
  const store = new LolPlaybackSchedules(
    ":memory:",
    { find: async () => match },
    f.ports,
  );
  try {
    const schedule = await store.create(
      lolSportsEvent(match),
      target,
      AbortSignal.timeout(1000),
    );
    const owned = item(schedule.id);
    const other = item();
    f.setView({
      ...IDLE_VIEW,
      state: "streaming",
      current: owned,
      queue: [other],
    });
    f.ports.stop(schedule);
    expect(f.dispatch).toHaveBeenLastCalledWith({ type: "SKIP" });
    f.setView({ ...IDLE_VIEW, state: "joining", queue: [other, owned] });
    f.ports.stop(schedule);
    expect(f.dispatch).toHaveBeenLastCalledWith({ type: "REMOVE", index: 1 });
    f.setView({ ...IDLE_VIEW, state: "streaming", current: other, queue: [] });
    f.ports.stop(schedule);
    expect(f.dispatch).toHaveBeenCalledTimes(2);
  } finally {
    store.close();
  }
});
