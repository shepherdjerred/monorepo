import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildResumeAnnouncement,
  buildResumeInput,
  buildSnapshot,
  resumeKeyFor,
} from "@shepherdjerred/streambot/state/resume.ts";
import {
  loadState,
  saveState,
  stateFilePath,
  type PersistedState,
} from "@shepherdjerred/streambot/state/persistence.ts";
import type {
  PlaybackContext,
  PlaybackInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const G = GuildIdSchema.parse("100000000000000010");
const OTHER_G = GuildIdSchema.parse("100000000000000099");
const C = ChannelIdSchema.parse("100000000000000020");
const U = UserIdSchema.parse("100000000000000001");

const BASE: PlaybackInput = { guildId: G, channelId: C, idleTimeoutMs: 30 };

function fileSource(title: string): Source {
  return { kind: "file", path: `/videos/${title}.mkv`, title };
}

function makeContext(over: Partial<PlaybackContext> = {}): PlaybackContext {
  return {
    guildId: G,
    channelId: C,
    idleTimeoutMs: 30,
    queue: [{ source: fileSource("next"), requesterId: U }],
    current: { source: fileSource("movie"), requesterId: U },
    voice: null,
    resolved: { title: "Movie Title", ffmpegInput: "/videos/movie.mkv" },
    loop: "queue",
    volume: 80,
    lastError: null,
    lastErrorKind: null,
    blockedNonce: 0,
    lastBlockedRequester: null,
    resumeSeekSeconds: 0,
    ...over,
  };
}

function makeState(over: Partial<PersistedState> = {}): PersistedState {
  return {
    version: 1,
    savedAt: 1000,
    guildId: G,
    channelId: C,
    loop: "off",
    volume: 100,
    current: {
      source: fileSource("movie"),
      requesterId: U,
      title: "Movie Title",
      positionSeconds: 90,
    },
    queue: [{ source: fileSource("next"), requesterId: U }],
    resumeAttempts: 0,
    resumeKey: resumeKeyFor(fileSource("movie")),
    ...over,
  };
}

describe("buildSnapshot", () => {
  test("captures current (with resolved title + floored position), queue, loop, volume", () => {
    const state = buildSnapshot({
      context: makeContext(),
      positionSeconds: 42.9,
      savedAt: 1234,
      resumeKey: "k",
      resumeAttempts: 1,
    });
    expect(state.version).toBe(1);
    expect(state.savedAt).toBe(1234);
    expect(state.loop).toBe("queue");
    expect(state.volume).toBe(80);
    expect(state.current?.source).toEqual(fileSource("movie"));
    expect(state.current?.title).toBe("Movie Title");
    expect(state.current?.positionSeconds).toBe(42);
    expect(state.queue).toEqual([
      { source: fileSource("next"), requesterId: U },
    ]);
    expect(state.resumeKey).toBe("k");
    expect(state.resumeAttempts).toBe(1);
  });

  test("null current serializes to null", () => {
    const state = buildSnapshot({
      context: makeContext({ current: null, resolved: null }),
      positionSeconds: 0,
      savedAt: 1,
      resumeKey: null,
      resumeAttempts: 0,
    });
    expect(state.current).toBeNull();
  });
});

describe("buildResumeInput", () => {
  const opts = { maxResumeAttempts: 3 };

  test("null restored → base input, nothing resumed", () => {
    const d = buildResumeInput(null, BASE, opts);
    expect(d.input).toEqual(BASE);
    expect(d.resumedCurrent).toBe(false);
  });

  test("guild mismatch → ignore restored entirely", () => {
    const d = buildResumeInput(makeState({ guildId: OTHER_G }), BASE, opts);
    expect(d.input).toEqual(BASE);
    expect(d.resumedCurrent).toBe(false);
  });

  test("resumes the in-progress item at queue[0] with its seek offset", () => {
    const d = buildResumeInput(makeState(), BASE, opts);
    expect(d.resumedCurrent).toBe(true);
    expect(d.input.initialSeekSeconds).toBe(90);
    expect(d.input.initialLoop).toBe("off");
    expect(d.input.initialVolume).toBe(100);
    expect(d.input.initialQueue).toEqual([
      { source: fileSource("movie"), requesterId: U },
      { source: fileSource("next"), requesterId: U },
    ]);
  });

  test("increments resumeAttempts when the key matches the last boot", () => {
    const key = resumeKeyFor(fileSource("movie"));
    const d = buildResumeInput(
      makeState({ resumeKey: key, resumeAttempts: 1 }),
      BASE,
      opts,
    );
    expect(d.resumeKey).toBe(key);
    expect(d.resumeAttempts).toBe(2);
  });

  test("crash-loop guard: drops the current item after maxResumeAttempts", () => {
    const key = resumeKeyFor(fileSource("movie"));
    const d = buildResumeInput(
      makeState({ resumeKey: key, resumeAttempts: 3 }),
      BASE,
      opts,
    );
    expect(d.droppedForCrashLoop).toBe(true);
    expect(d.resumedCurrent).toBe(false);
    expect(d.input.initialSeekSeconds).toBeUndefined();
    // The rest of the queue still resumes.
    expect(d.input.initialQueue).toEqual([
      { source: fileSource("next"), requesterId: U },
    ]);
  });

  test("queue-only state (nothing was mid-play) restores the queue without a seek", () => {
    const d = buildResumeInput(
      makeState({ current: null, resumeKey: null }),
      BASE,
      opts,
    );
    expect(d.resumedCurrent).toBe(false);
    expect(d.input.initialSeekSeconds).toBeUndefined();
    expect(d.input.initialQueue).toEqual([
      { source: fileSource("next"), requesterId: U },
    ]);
  });
});

describe("buildResumeAnnouncement", () => {
  const opts = { maxResumeAttempts: 3 };

  test("null restored → no message", () => {
    expect(
      buildResumeAnnouncement(null, buildResumeInput(null, BASE, opts)),
    ).toBeNull();
  });

  test("resuming a movie names the title and timecode", () => {
    const restored = makeState();
    const msg = buildResumeAnnouncement(
      restored,
      buildResumeInput(restored, BASE, opts),
    );
    expect(msg).toContain("Movie Title");
    expect(msg).toContain("1:30");
    expect(msg).toContain("resuming");
  });

  test("crash-loop drop mentions the queue continuation", () => {
    const key = resumeKeyFor(fileSource("movie"));
    const restored = makeState({ resumeKey: key, resumeAttempts: 3 });
    const msg = buildResumeAnnouncement(
      restored,
      buildResumeInput(restored, BASE, opts),
    );
    expect(msg).toContain("couldn't safely resume");
    expect(msg).toContain("1 item");
  });

  test("queue-only restore mentions the count", () => {
    const restored = makeState({ current: null, resumeKey: null });
    const msg = buildResumeAnnouncement(
      restored,
      buildResumeInput(restored, BASE, opts),
    );
    expect(msg).toContain("restored the queue");
    expect(msg).toContain("1 item");
  });

  test("nothing to resume → no message", () => {
    const restored = makeState({ current: null, queue: [], resumeKey: null });
    expect(
      buildResumeAnnouncement(restored, buildResumeInput(restored, BASE, opts)),
    ).toBeNull();
  });
});

describe("snapshot → persist → restore round-trip", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true })),
    );
  });

  test("reproduces queue/current/loop/volume through disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "streambot-resume-"));
    dirs.push(dir);
    const file = stateFilePath(dir);

    const snapshot = buildSnapshot({
      context: makeContext(),
      positionSeconds: 123,
      savedAt: 5000,
      resumeKey: resumeKeyFor(fileSource("movie")),
      resumeAttempts: 0,
    });
    await saveState(file, snapshot);
    const loaded = await loadState(file, 3600, 5000);
    expect(loaded).not.toBeNull();

    const decision = buildResumeInput(loaded, BASE, { maxResumeAttempts: 3 });
    expect(decision.input.initialLoop).toBe("queue");
    expect(decision.input.initialVolume).toBe(80);
    expect(decision.input.initialSeekSeconds).toBe(123);
    expect(decision.input.initialQueue).toEqual([
      { source: fileSource("movie"), requesterId: U },
      { source: fileSource("next"), requesterId: U },
    ]);
  });
});
