import { afterEach, expect, test, vi } from "vitest";
import type { ReplaySession, ReplaySessionState } from "@scout-for-lol/replay";
import {
  fetchMatchReplay,
  fetchPublicReplay,
  fetchPublicReplayTimeline,
  PublicReplayHttpError,
  publicReplayTimelineQuery,
  qualifiedReplayMatch,
} from "./api.ts";
import {
  claimReplaySession,
  loadReplayBytes,
  loadPublicReplaySession,
} from "./load-session.ts";
import { MAX_PUBLIC_REPLAY_BYTES } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { readReplayShareState, replayShareUrl } from "./share-state.ts";
import { replayFixture } from "./replay-fixture.ts";
import { runReplayCommand } from "./commands.ts";

afterEach(() => vi.unstubAllGlobals());
const canvasFactory = vi.fn<() => HTMLCanvasElement>();

test("anonymous reads omit credentials and qualify platform/game identities", async () => {
  const requests = vi
    .fn()
    .mockResolvedValue(Response.json({ replay: replayFixture }));
  vi.stubGlobal("fetch", requests);
  const abort = new AbortController();
  await expect(
    fetchMatchReplay("NA1_1234567890", abort.signal),
  ).resolves.toEqual({ replay: replayFixture });
  expect(requests).toHaveBeenCalledWith(
    "/api/replays?platformId=NA1&gameId=1234567890",
    { credentials: "omit", signal: abort.signal },
  );
  expect(qualifiedReplayMatch("na1_1")).toEqual({
    platformId: "NA1",
    gameId: "1",
  });
  expect(qualifiedReplayMatch("5667809143")).toBeNull();
  requests.mockClear();
  await expect(fetchMatchReplay("5667809143")).resolves.toEqual({
    replay: null,
  });
  expect(requests).not.toHaveBeenCalled();
});

test("404 replay reads produce a useful boundary error; malformed descriptors fail validation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
  );
  await expect(
    fetchPublicReplay(replayFixture.replayId),
  ).rejects.toBeInstanceOf(PublicReplayHttpError);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...replayFixture, deviceId: "private" }),
      ),
  );
  await expect(fetchPublicReplay(replayFixture.replayId)).rejects.toThrow();
});

test("public timeline requests are anonymous, abortable, and reject private fields", async () => {
  const requests = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ timeline: null }));
  vi.stubGlobal("fetch", requests);
  const { replayId } = replayFixture;
  expect(publicReplayTimelineQuery(replayId, false).enabled).toBe(false);
  const signal = new AbortController().signal;
  await expect(fetchPublicReplayTimeline(replayId, signal)).resolves.toEqual({
    timeline: null,
  });
  expect(requests).toHaveBeenCalledWith(`/api/replays/${replayId}/timeline`, {
    credentials: "omit",
    signal,
  });
  requests.mockResolvedValueOnce(
    Response.json({
      timeline: {
        source: "riot_match_timeline",
        events: [
          {
            id: 0,
            timestampMs: 12_345,
            type: "CHAMPION_KILL",
            objective: null,
            teamId: 100,
            participantId: 1,
          },
        ],
      },
    }),
  );
  await expect(fetchPublicReplayTimeline(replayId, signal)).rejects.toThrow();
});

const sessionState: ReplaySessionState = {
  timeSeconds: 82.35,
  durationSeconds: 1534.5,
  playing: false,
  rate: 1,
  perspective: "blue",
  camera: { mode: "follow", participantId: 2 },
  participants: [],
};

test("share links preserve only replay time, followed player, and perspective", () => {
  const url = new URL(
    replayShareUrl(
      "https://scout-for-lol.com/app/replays/id?tracking=private#debug",
      sessionState,
    ),
  );
  expect(url.searchParams.get("t")).toBe("82.35");
  expect(url.searchParams.get("follow")).toBe("2");
  expect(url.searchParams.get("perspective")).toBe("blue");
  expect(url.searchParams.has("tracking")).toBe(false);
  expect(url.hash).toBe("");
  expect(
    readReplayShareState("?t=Infinity&follow=-2&perspective=enemy", 120),
  ).toEqual({ timeSeconds: 0, participantId: null, perspective: "all" });
  expect(readReplayShareState("?t=200&follow=3&perspective=red", 120)).toEqual({
    timeSeconds: 120,
    participantId: 3,
    perspective: "red",
  });
  expect(readReplayShareState("?follow=0", 120).participantId).toBe(0);
  expect(readReplayShareState("?follow=", 120).participantId).toBeNull();
});

test("copying a deep link before playback preserves its valid replay state", () => {
  const href = "https://scout-for-lol.com/app/replays/id";
  expect(
    replayShareUrl(
      `${href}?t=75.512&follow=0&perspective=red&tracking=private#debug`,
      null,
    ),
  ).toBe(`${href}?t=75.512&follow=0&perspective=red`);
  expect(
    replayShareUrl(`${href}?t=Infinity&follow=-1&perspective=enemy`, null),
  ).toBe(href);
  expect(replayShareUrl(`${href}?t=&follow=`, null)).toBe(href);
});

test("share links preserve the recorded time on both sides of a replay transition", () => {
  const href = "https://scout-for-lol.com/app/replays/id";
  // First death in the retained 16.23 Ranked replay.
  const deathTime = 79.45458999633789;
  for (const timeSeconds of [deathTime - 0.0001, deathTime]) {
    const liveUrl = new URL(
      replayShareUrl(href, { ...sessionState, timeSeconds }),
    );
    expect(readReplayShareState(liveUrl.search, 1757.163).timeSeconds).toBe(
      timeSeconds,
    );
    const inactiveUrl = new URL(
      replayShareUrl(`${href}?t=${String(timeSeconds)}`, null),
    );
    expect(readReplayShareState(inactiveUrl.search, 1757.163).timeSeconds).toBe(
      timeSeconds,
    );
  }
});

async function admittedReplay() {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    bytes,
    replay: {
      ...replayFixture,
      bytes: bytes.byteLength,
      sha256,
      playback: {
        status: "available" as const,
        latestPatch: "16.21",
        package: {
          url: "/replay-assets/manifest.json",
          sha256: "b".repeat(64),
        },
      },
    },
  };
}

test("replay bytes are verified before they can initialize an engine", async () => {
  const { bytes, replay } = await admittedReplay();
  await expect(
    loadReplayBytes(
      { ...replay, sha256: "a".repeat(64) },
      new AbortController().signal,
      vi.fn().mockResolvedValue(new Response(bytes)),
    ),
  ).rejects.toThrow("could not be verified");
  await expect(
    loadReplayBytes(
      replay,
      new AbortController().signal,
      vi.fn().mockResolvedValue(new Response(bytes)),
    ),
  ).resolves.toEqual(bytes);
});

test("an engine resolving after navigation is disposed and never published", async () => {
  const abort = new AbortController();
  const dispose = vi.fn();
  const owned: ReplaySession = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn<ReplaySession["seek"]>().mockResolvedValue(undefined),
    setRate: vi.fn(),
    focusParticipant: vi.fn(),
    setCamera: vi.fn(),
    setPerspective: vi.fn(),
    resize: vi.fn(),
    dispose,
    getState: vi.fn<ReplaySession["getState"]>().mockReturnValue(sessionState),
    subscribe: vi.fn<ReplaySession["subscribe"]>().mockReturnValue(vi.fn()),
    subscribeErrors: vi
      .fn<ReplaySession["subscribeErrors"]>()
      .mockReturnValue(vi.fn()),
  };
  const pending = Promise.resolve(owned);
  abort.abort();
  await expect(claimReplaySession(pending, abort.signal)).rejects.toThrow();
  expect(dispose).toHaveBeenCalledOnce();
});

test.each([120, 1070.125, Number.NaN, Number.POSITIVE_INFINITY, 0])(
  "a native engine duration of %s cannot replace the validated full replay",
  async (durationSeconds) => {
    const { bytes, replay } = await admittedReplay();
    const dispose = vi.fn();
    const session: ReplaySession = {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn<ReplaySession["seek"]>().mockResolvedValue(undefined),
      setRate: vi.fn(),
      focusParticipant: vi.fn(),
      setCamera: vi.fn(),
      setPerspective: vi.fn(),
      resize: vi.fn(),
      dispose,
      getState: () => ({ ...sessionState, durationSeconds }),
      subscribe: vi.fn<ReplaySession["subscribe"]>().mockReturnValue(vi.fn()),
      subscribeErrors: vi
        .fn<ReplaySession["subscribeErrors"]>()
        .mockReturnValue(vi.fn()),
    };
    await expect(
      loadPublicReplaySession({
        replay: { ...replay, durationSeconds: 1070.123 },
        canvas: canvasFactory(),
        signal: new AbortController().signal,
        factory: () => Promise.resolve(session),
        fetcher: vi.fn().mockResolvedValue(new Response(bytes)),
      }),
    ).rejects.toThrow("validated full duration");
    expect(dispose).toHaveBeenCalledOnce();
  },
);

test("native duration comparison honors container millisecond precision", async () => {
  const { bytes, replay } = await admittedReplay();
  const dispose = vi.fn();
  const session: ReplaySession = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn<ReplaySession["seek"]>().mockResolvedValue(undefined),
    setRate: vi.fn(),
    focusParticipant: vi.fn(),
    setCamera: vi.fn(),
    setPerspective: vi.fn(),
    resize: vi.fn(),
    dispose,
    getState: () => ({ ...sessionState, durationSeconds: 1070.124 }),
    subscribe: vi.fn<ReplaySession["subscribe"]>().mockReturnValue(vi.fn()),
    subscribeErrors: vi
      .fn<ReplaySession["subscribeErrors"]>()
      .mockReturnValue(vi.fn()),
  };
  await expect(
    loadPublicReplaySession({
      replay: { ...replay, durationSeconds: 1070.123 },
      canvas: canvasFactory(),
      signal: new AbortController().signal,
      factory: () => Promise.resolve(session),
      fetcher: vi.fn().mockResolvedValue(new Response(bytes)),
    }),
  ).resolves.toBe(session);
  expect(dispose).not.toHaveBeenCalled();
});

test("oversized stream chunks are canceled before buffering beyond the descriptor", async () => {
  const { replay } = await admittedReplay();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
    },
    cancel,
  });
  await expect(
    loadReplayBytes(
      replay,
      new AbortController().signal,
      vi.fn().mockResolvedValue(new Response(body)),
    ),
  ).rejects.toThrow("exceeded its expected size");
  expect(cancel).toHaveBeenCalledOnce();
  const fetcher = vi.fn();
  await expect(
    loadReplayBytes(
      { ...replay, bytes: MAX_PUBLIC_REPLAY_BYTES + 1 },
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toThrow("supported download size");
  expect(fetcher).not.toHaveBeenCalled();
});

test("navigation abort cancels an unfinished response stream", async () => {
  const { replay } = await admittedReplay();
  const abort = new AbortController();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull() {
      abort.abort();
    },
    cancel,
  });
  await expect(
    loadReplayBytes(
      replay,
      abort.signal,
      vi.fn().mockResolvedValue(new Response(body)),
    ),
  ).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
});

test("a newer scrub supersedes a pending seek without retiring the player, while real errors stay fatal", async () => {
  let rejectFirst: ((reason: unknown) => void) | undefined;
  const pending = new Promise<void>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const seek = vi
    .fn<ReplaySession["seek"]>()
    .mockImplementationOnce(() => pending)
    .mockImplementationOnce(async () => {
      rejectFirst?.(new DOMException("Replay seek superseded", "AbortError"));
    });
  const active: ReplaySession = {
    play: vi.fn(),
    pause: vi.fn(),
    seek,
    setRate: vi.fn(),
    focusParticipant: vi.fn(),
    setCamera: vi.fn(),
    setPerspective: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getState: vi.fn<ReplaySession["getState"]>().mockReturnValue(sessionState),
    subscribe: vi.fn<ReplaySession["subscribe"]>().mockReturnValue(vi.fn()),
    subscribeErrors: vi
      .fn<ReplaySession["subscribeErrors"]>()
      .mockReturnValue(vi.fn()),
  };
  const onFailure = vi.fn((_error: unknown, failed: ReplaySession) => {
    failed.dispose();
  });
  const current = () => active;
  const first = runReplayCommand(
    current,
    (session) => session.seek(74),
    onFailure,
  );
  const second = runReplayCommand(
    current,
    (session) => session.seek(82.35),
    onFailure,
  );
  await Promise.all([first, second]);
  expect(seek.mock.calls).toEqual([[74], [82.35]]);
  expect(onFailure).not.toHaveBeenCalled();
  expect(active.dispose).not.toHaveBeenCalled();
  await runReplayCommand(
    current,
    (session) => {
      session.play();
    },
    onFailure,
  );
  expect(active.play).toHaveBeenCalledOnce();
  const failure = new Error("Replay seek superseded");
  seek.mockRejectedValueOnce(failure);
  await runReplayCommand(current, (session) => session.seek(90), onFailure);
  expect(onFailure).toHaveBeenCalledWith(failure, active);
  expect(active.dispose).toHaveBeenCalledOnce();
});
