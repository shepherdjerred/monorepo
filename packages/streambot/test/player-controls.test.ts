import { describe, expect, test } from "bun:test";
import {
  CONTROL_ID_PREFIX,
  ControlAction,
  decodeControlId,
  encodeControlId,
  nextLoopMode,
  resolveControlAction,
  type ControlOutcome,
} from "@shepherdjerred/streambot/discord/player-controls.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import {
  UserIdSchema,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";

const ADMIN = UserIdSchema.parse("100000000000000001");
const REQUESTER = UserIdSchema.parse("100000000000000002");
const BYSTANDER = UserIdSchema.parse("100000000000000003");
const ADMINS: readonly UserId[] = [ADMIN];

const CHAPTERS = [
  { index: 1, title: "Intro", startSeconds: 0, endSeconds: 90 },
  { index: 2, title: "The Heist", startSeconds: 90, endSeconds: 600 },
];

function view(over: Partial<PlaybackView> = {}): PlaybackView {
  return {
    state: "streaming",
    current: {
      title: "Heat (1995)",
      requesterId: REQUESTER,
      chapters: CHAPTERS,
      kind: "file",
      durationSeconds: 600,
    },
    queue: [],
    loop: "off",
    volume: 100,
    positionSeconds: 300,
    ...over,
  };
}

function resolve(
  action: ControlAction,
  over: {
    userId?: UserId;
    view?: PlaybackView;
    inVoiceChannel?: boolean;
    chapterNumber?: number;
  } = {},
): ControlOutcome {
  return resolveControlAction({
    action,
    view: over.view ?? view(),
    userId: over.userId ?? BYSTANDER,
    adminIds: ADMINS,
    inVoiceChannel: over.inVoiceChannel ?? true,
    chapterNumber: over.chapterNumber,
  });
}

describe("control ids", () => {
  test("round-trip every action", () => {
    for (const action of Object.values(ControlAction)) {
      expect(decodeControlId(encodeControlId(action))).toBe(action);
    }
  });

  test("ignores ids outside the namespace so other collectors keep working", () => {
    expect(decodeControlId("page_next")).toBeNull();
    expect(decodeControlId("subtitle_track_pick")).toBeNull();
    expect(decodeControlId("")).toBeNull();
  });

  test("rejects an unknown action inside the namespace", () => {
    expect(decodeControlId(`${CONTROL_ID_PREFIX}selfdestruct`)).toBeNull();
  });
});

describe("loop cycling", () => {
  test("off → track → queue → off", () => {
    expect(nextLoopMode("off")).toBe("track");
    expect(nextLoopMode("track")).toBe("queue");
    expect(nextLoopMode("queue")).toBe("off");
  });

  test("an unrecognized mode restarts the cycle instead of throwing", () => {
    expect(nextLoopMode("nonsense")).toBe("track");
  });
});

describe("voice-channel gate", () => {
  test("every action is denied to someone outside the voice channel", () => {
    for (const action of Object.values(ControlAction)) {
      const outcome = resolve(action, {
        userId: ADMIN,
        inVoiceChannel: false,
        chapterNumber: 1,
      });
      expect(outcome.kind).toBe("denied");
    }
  });
});

describe("permission tiers", () => {
  test("stop is admin-only", () => {
    expect(resolve(ControlAction.Stop, { userId: ADMIN })).toEqual({
      kind: "dispatch",
      event: { type: "STOP" },
      ack: "⏹️ Stopped and cleared the queue.",
    });
    for (const userId of [REQUESTER, BYSTANDER]) {
      const outcome = resolve(ControlAction.Stop, { userId });
      expect(outcome).toEqual({
        kind: "denied",
        message: "Only an admin can stop playback.",
      });
    }
  });

  test("skip is requester-or-admin", () => {
    for (const userId of [ADMIN, REQUESTER]) {
      expect(resolve(ControlAction.Skip, { userId }).kind).toBe("dispatch");
    }
    expect(resolve(ControlAction.Skip, { userId: BYSTANDER })).toEqual({
      kind: "denied",
      message: "Only the requester or an admin can skip this.",
    });
  });

  test("subtitles is requester-or-admin, matching /stream subtitles", () => {
    for (const userId of [ADMIN, REQUESTER]) {
      expect(resolve(ControlAction.Subtitles, { userId }).kind).toBe(
        "subtitle-picker",
      );
    }
    expect(resolve(ControlAction.Subtitles, { userId: BYSTANDER }).kind).toBe(
      "denied",
    );
  });

  test("seek, volume, loop, shuffle and queue are open to anyone in the channel", () => {
    const open = [
      ControlAction.Back,
      ControlAction.Forward,
      ControlAction.VolumeUp,
      ControlAction.VolumeDown,
      ControlAction.Loop,
      ControlAction.Shuffle,
      ControlAction.Queue,
    ];
    for (const action of open) {
      expect(resolve(action, { userId: BYSTANDER }).kind).not.toBe("denied");
    }
  });
});

describe("volume", () => {
  test("steps by 10 in each direction", () => {
    expect(resolve(ControlAction.VolumeUp)).toEqual({
      kind: "volume",
      percent: 110,
      ack: "🔊 Volume → 110%.",
    });
    expect(resolve(ControlAction.VolumeDown)).toEqual({
      kind: "volume",
      percent: 90,
      ack: "🔊 Volume → 90%.",
    });
  });

  test("clamps at the 0 and 200 bounds /stream volume enforces", () => {
    const quiet = resolve(ControlAction.VolumeDown, {
      view: view({ volume: 5 }),
    });
    expect(quiet).toMatchObject({ kind: "volume", percent: 0 });
    const loud = resolve(ControlAction.VolumeUp, {
      view: view({ volume: 195 }),
    });
    expect(loud).toMatchObject({ kind: "volume", percent: 200 });
  });
});

describe("relative seek", () => {
  test("moves 30 seconds from the live position", () => {
    expect(resolve(ControlAction.Forward)).toEqual({
      kind: "seek",
      seconds: 330,
      ack: "⏩ Seeked to 5:30.",
    });
    expect(resolve(ControlAction.Back)).toEqual({
      kind: "seek",
      seconds: 270,
      ack: "⏪ Seeked to 4:30.",
    });
  });

  test("rewinding near the start clamps to 0 instead of a negative offset", () => {
    const outcome = resolve(ControlAction.Back, {
      view: view({ positionSeconds: 10 }),
    });
    expect(outcome).toMatchObject({ kind: "seek", seconds: 0 });
  });

  test("skipping forward near the end stops short of EOF", () => {
    const outcome = resolve(ControlAction.Forward, {
      view: view({ positionSeconds: 590 }),
    });
    // duration 600, so the cap is 595 rather than 620 (which would look like a truncation).
    expect(outcome).toMatchObject({ kind: "seek", seconds: 595 });
  });

  test("an unknown duration leaves forward seeking uncapped", () => {
    const live = view({
      current: {
        title: "Live Stream",
        requesterId: REQUESTER,
        chapters: [],
        kind: "url",
        durationSeconds: null,
      },
    });
    expect(resolve(ControlAction.Forward, { view: live })).toMatchObject({
      kind: "seek",
      seconds: 330,
    });
  });

  test("seeking with nothing playing is refused", () => {
    const idle = view({ current: null, positionSeconds: null });
    expect(resolve(ControlAction.Forward, { view: idle })).toEqual({
      kind: "denied",
      message: "Nothing is playing.",
    });
  });
});

describe("chapter menu", () => {
  test("jumps to the picked chapter's start", () => {
    expect(resolve(ControlAction.Chapter, { chapterNumber: 2 })).toEqual({
      kind: "seek",
      seconds: 90,
      ack: "⏩ Chapter 2: **The Heist** (1:30).",
    });
  });

  test("an out-of-range pick reports how many chapters exist", () => {
    const outcome = resolve(ControlAction.Chapter, { chapterNumber: 9 });
    expect(outcome).toEqual({
      kind: "denied",
      message: "There's no chapter 9. This video has 2.",
    });
  });

  test("a pick with no value is refused rather than defaulting to chapter 1", () => {
    expect(resolve(ControlAction.Chapter)).toEqual({
      kind: "denied",
      message: "No chapter was selected.",
    });
  });
});

describe("queue button", () => {
  test("summarizes the queue without mutating anything", () => {
    const withQueue = view({
      queue: [
        {
          title: "Item A",
          requesterId: REQUESTER,
          chapters: [],
          kind: "search",
          durationSeconds: null,
        },
      ],
    });
    expect(resolve(ControlAction.Queue, { view: withQueue })).toEqual({
      kind: "ephemeral",
      text: `**Now:** Heat (1995)\n1. Item A (<@${REQUESTER}>)`,
    });
  });

  test("says so when there is nothing queued or playing", () => {
    const idle = view({ current: null, positionSeconds: null });
    expect(resolve(ControlAction.Queue, { view: idle })).toEqual({
      kind: "ephemeral",
      text: "The queue is empty.",
    });
  });
});
