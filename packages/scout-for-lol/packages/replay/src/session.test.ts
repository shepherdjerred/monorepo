import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayRenderPackageManifest } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import {
  createVerifiedResources,
  loadVerifiedManifest,
  sha256,
} from "./resources.ts";
import { createSessionWithEngine } from "./session.ts";
import type {
  CreateReplayEngineOptions,
  ReplayEngineSession,
} from "./engine.ts";
import type { ReplaySessionState } from "./types.ts";

const root = new URL("https://scout.invalid/packages/owned/manifest.json");
const build = "16.21.829.8620";
const protocol = "20e09df23c66b85e";
const bytes = new TextEncoder().encode("resource");
const inventoryHash = "a".repeat(64);
const manifest: ReplayRenderPackageManifest = {
  schemaVersion: 1,
  gameBuild: build,
  protocol,
  entrypoint: "engine.mjs",
  capabilities: {
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
    rosterCoverage: "all-legal-lineups-and-skins",
    rosterInventorySha256: inventoryHash,
  },
  files: [
    {
      path: "engine.mjs",
      sha256: await sha256(bytes),
      bytes: bytes.byteLength,
    },
  ],
};
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
const manifestSha256 = await sha256(manifestBytes);
const replay = new ArrayBuffer(64);
const replayBytes = new Uint8Array(replay);
replayBytes.set(new TextEncoder().encode("RIOT"));
new DataView(replay).setUint16(4, 2, true);
replayBytes.set(
  Uint8Array.from(protocol.match(/../g) ?? [], (part) =>
    Number.parseInt(part, 16),
  ),
  6,
);
replayBytes[14] = build.length;
replayBytes.set(new TextEncoder().encode(build), 15);

function intercept() {
  const fetcher = vi.fn((url: URL) =>
    Promise.resolve(
      new Response(url.href === root.href ? manifestBytes : bytes),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const state: ReplaySessionState = {
  timeSeconds: 0,
  durationSeconds: 60,
  playing: false,
  rate: 1,
  perspective: "all",
  camera: { mode: "free" },
  participants: Array.from({ length: 10 }, (_, participantId) => ({
    participantId,
    name: `Recorded player ${participantId.toString()}`,
    championName: "Ornn",
    teamId: participantId < 5 ? 100 : 200,
  })),
};

function engine(
  firstFrame = Promise.resolve(),
  firstState = state,
): ReplayEngineSession {
  return {
    firstFrame,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(() => Promise.resolve()),
    setRate: vi.fn(),
    focusParticipant: vi.fn(),
    setCamera: vi.fn(),
    setPerspective: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getState: () => firstState,
    subscribe: vi.fn(() => ignoreUnsubscribe),
  };
}
const canvasFactory = vi.fn<() => HTMLCanvasElement>();
function ignoreUnsubscribe(): void {
  // Controlled lifecycle adapters hold no actual DOM subscription.
}

it("forwards optional free-camera controls only for supporting engines", async () => {
  intercept();
  const panCamera = vi.fn<NonNullable<ReplayEngineSession["panCamera"]>>();
  const capabilities = {
    perspectives: ["all"],
    directedCamera: false,
  } as const;
  const supported = await createSessionWithEngine(options(), () =>
    Promise.resolve(() =>
      Promise.resolve({ ...engine(), capabilities, panCamera }),
    ),
  );
  const standard = await createSessionWithEngine(options(), () =>
    Promise.resolve(() => Promise.resolve(engine())),
  );
  expect(supported.capabilities).toEqual(capabilities);
  supported.panCamera?.(38, -24);
  expect(panCamera).toHaveBeenCalledExactlyOnceWith(38, -24);
  expect(standard.panCamera).toBeUndefined();
  expect(standard.capabilities).toBeUndefined();
  supported.dispose();
  expect(() => supported.panCamera?.(1, 1)).toThrow();
  expect(panCamera).toHaveBeenCalledTimes(1);
  standard.dispose();
});

describe("recorded scoreboard state", () => {
  it("shares immutable checkpoints with readers and notifications", async () => {
    intercept();
    const scoreboard = Object.freeze({
      blueKills: 2,
      redKills: null,
      winningTeam: null,
      players: Object.freeze([
        Object.freeze({
          participantId: 0,
          kills: 2,
          deaths: 1,
          assists: 0,
          level: null,
        }),
      ]),
    });
    const firstState = { ...state, scoreboard };
    const onState = vi.fn<NonNullable<CreateReplayEngineOptions["onState"]>>();
    const listener = vi.fn<NonNullable<CreateReplayEngineOptions["onState"]>>();
    let notify: CreateReplayEngineOptions["onState"] | undefined;
    const session = await createSessionWithEngine(
      { ...options(), onState },
      () =>
        Promise.resolve((settings) => {
          notify = settings.onState;
          return Promise.resolve(engine(Promise.resolve(), firstState));
        }),
    );
    session.subscribe(listener);
    expect(session.getState().scoreboard).toBe(scoreboard);
    expect(session.getState().participants).not.toBe(firstState.participants);
    for (const observe of [onState, listener])
      expect(observe.mock.calls[0]?.[0].scoreboard).toBe(scoreboard);
    const finalState: ReplaySessionState = {
      ...firstState,
      timeSeconds: state.durationSeconds,
      scoreboard: Object.freeze({ ...scoreboard, winningTeam: 100 }),
    };
    expect(notify).toBeTypeOf("function");
    notify?.(finalState);
    notify?.(firstState);
    for (const observe of [onState, listener]) {
      expect(observe.mock.calls[1]?.[0].scoreboard).toBe(finalState.scoreboard);
      expect(observe.mock.calls[2]?.[0].scoreboard).toBe(scoreboard);
    }
    session.dispose();
  });

  it("isolates nested values when an engine returns mutable player rows", async () => {
    intercept();
    const player = {
      participantId: 0,
      kills: 2,
      deaths: null,
      assists: null,
      level: null,
    };
    const scoreboard = Object.freeze({
      blueKills: null,
      redKills: null,
      winningTeam: null,
      players: Object.freeze([player]),
    });
    const session = await createSessionWithEngine(options(), () =>
      Promise.resolve(() =>
        Promise.resolve(engine(Promise.resolve(), { ...state, scoreboard })),
      ),
    );
    const snapshot = session.getState().scoreboard;
    player.kills = 3;
    expect(snapshot?.players[0]?.kills).toBe(2);
    expect(session.getState().scoreboard?.players[0]?.kills).toBe(3);
    session.dispose();
  });
});

describe("fatal renderer failures", () => {
  it("disposes an active session and preserves the original asynchronous cause", async () => {
    intercept();
    const adapter = engine();
    let fail: ((cause: unknown) => void) | undefined;
    const session = await createSessionWithEngine(options(), () =>
      Promise.resolve((settings: CreateReplayEngineOptions) => {
        fail = settings.onError;
        return Promise.resolve(adapter);
      }),
    );
    const listener = vi.fn();
    session.subscribeErrors(listener);
    const cause = new Error("Decoded worker frame rejected");
    expect(fail).toBeTypeOf("function");
    fail?.(cause);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "engine-failed",
        message: cause.message,
        cause,
      }),
    );
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(() => session.play()).toThrow(cause.message);
    const late = vi.fn();
    session.subscribeErrors(late);
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ cause }));
    fail?.(new Error("Duplicate callback"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rejects a synchronous startup error and disposes the later engine result", async () => {
    intercept();
    const adapter = engine(),
      cause = new Error("Startup shader failed");
    await expect(
      createSessionWithEngine(options(), () =>
        Promise.resolve((settings: CreateReplayEngineOptions) => {
          settings.onError(cause);
          return Promise.resolve(adapter);
        }),
      ),
    ).rejects.toMatchObject({
      code: "engine-failed",
      message: cause.message,
      cause,
    });
    await vi.waitFor(() => {
      expect(adapter.dispose).toHaveBeenCalledOnce();
    });
  });

  it("unsubscribes and ignores failures from disposed owners", async () => {
    intercept();
    const adapter = engine();
    let fail: ((cause: unknown) => void) | undefined;
    const session = await createSessionWithEngine(options(), () =>
      Promise.resolve((settings: CreateReplayEngineOptions) => {
        fail = settings.onError;
        return Promise.resolve(adapter);
      }),
    );
    const listener = vi.fn(),
      unsubscribe = session.subscribeErrors(listener);
    unsubscribe();
    session.dispose();
    fail?.(new Error("Old worker completed late"));
    expect(listener).not.toHaveBeenCalled();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});
const options = () => ({
  canvas: canvasFactory(),
  replay: replay.slice(0),
  manifestUrl: root.href,
  manifestSha256,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verified replay resources", () => {
  it("verifies the root manifest before interpreting its claims", async () => {
    intercept();
    await expect(
      loadVerifiedManifest(root, "0".repeat(64), new AbortController().signal),
    ).rejects.toMatchObject({ code: "invalid-package" });
    await expect(
      loadVerifiedManifest(root, manifestSha256, new AbortController().signal),
    ).resolves.toEqual(manifest);
  });

  it("checks inventory bytes once and gives each consumer an owned copy", async () => {
    const fetcher = intercept();
    const resources = createVerifiedResources(
      manifest,
      root,
      new AbortController().signal,
    );
    const first = await resources.read("engine.mjs");
    first[0] = 0;
    expect(await resources.read("engine.mjs")).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(resources.read("other.mjs")).rejects.toMatchObject({
      code: "invalid-package",
    });
    resources.dispose();
    await expect(resources.read("engine.mjs")).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it.each(["dispose", "abort"] as const)(
    "rejects cached resource delivery when %s runs before handoff",
    async (end) => {
      const fetcher = intercept();
      const controller = new AbortController();
      const resources = createVerifiedResources(
        manifest,
        root,
        controller.signal,
      );
      await resources.read("engine.mjs");
      await resources.objectUrl("engine.mjs");
      const pendingBytes = resources.read("engine.mjs");
      const pendingUrl = resources.objectUrl("engine.mjs");
      if (end === "dispose") resources.dispose();
      else controller.abort();

      await Promise.all([
        expect(pendingBytes).rejects.toMatchObject({ name: "AbortError" }),
        expect(pendingUrl).rejects.toMatchObject({ name: "AbortError" }),
      ]);
      expect(fetcher).toHaveBeenCalledOnce();
      resources.dispose();
    },
  );

  it("rejects changed resources and normalized paths outside the package", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("tampered")));
    const resources = createVerifiedResources(
      manifest,
      root,
      new AbortController().signal,
    );
    await expect(resources.read("engine.mjs")).rejects.toMatchObject({
      code: "invalid-package",
    });
    const escaped = createVerifiedResources(
      {
        ...manifest,
        files: [{ ...manifest.files[0]!, path: "%2e%2e/other.mjs" }],
      },
      root,
      new AbortController().signal,
    );
    await expect(escaped.read("%2e%2e/other.mjs")).rejects.toThrow("escaped");
    resources.dispose();
    escaped.dispose();
  });

  it("cancels a streaming response as soon as it exceeds its declared bytes", async () => {
    const cancelled = vi.fn();
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(bytes.byteLength + 1));
            },
            cancel: cancelled,
          }),
        ),
      ),
    );
    const resources = createVerifiedResources(
      manifest,
      root,
      new AbortController().signal,
    );
    await expect(resources.read("engine.mjs")).rejects.toThrow("byte limit");
    expect(cancelled).toHaveBeenCalledOnce();
    resources.dispose();
  });

  it("cancels a pending body read when its owner aborts", async () => {
    const cancelled = vi.fn();
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(new ReadableStream({ cancel: cancelled }))),
    );
    vi.stubGlobal("fetch", fetcher);
    const abort = new AbortController();
    const resources = createVerifiedResources(manifest, root, abort.signal);
    const pending = resources.read("engine.mjs");
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledOnce();
    });
    abort.abort();
    await rejection;
    expect(cancelled).toHaveBeenCalledOnce();
    resources.dispose();
  });

  it("uses verified same-origin module paths under Scout's script-src policy", async () => {
    intercept();
    vi.stubGlobal(
      "location",
      new URL("https://scout.invalid/app/replays/test"),
    );
    const resources = createVerifiedResources(
      manifest,
      root,
      new AbortController().signal,
    );
    expect(await resources.moduleUrl("engine.mjs")).toBe(
      "https://scout.invalid/packages/owned/engine.mjs",
    );
    vi.stubGlobal("location", new URL("https://other.invalid/"));
    await expect(resources.moduleUrl("engine.mjs")).rejects.toThrow(
      "Scout origin",
    );
    resources.dispose();
  });
});

describe("replay session disposal failures", () => {
  it("releases resources and clears subscriptions when explicit engine disposal throws", async () => {
    intercept();
    const failure = new Error("Engine disposal failed");
    const terminate = vi.fn();
    vi.stubGlobal(
      "Worker",
      class {
        terminate = terminate;
      },
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      const adapter = {
        ...engine(),
        dispose: vi.fn(() => {
          throw failure;
        }),
      };
      let owner: CreateReplayEngineOptions | undefined;
      const session = await createSessionWithEngine(options(), () =>
        Promise.resolve(async (settings: CreateReplayEngineOptions) => {
          owner = settings;
          await settings.resources.worker("engine.mjs");
          return adapter;
        }),
      );
      const errorListener = vi.fn();
      session.subscribeErrors(errorListener);
      expect(() => session.dispose()).toThrow(failure);
      expect(terminate).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(revoke).toHaveBeenCalledOnce());
      owner?.onError(new Error("Disposed owner reported a late error"));
      expect(errorListener).not.toHaveBeenCalled();
      session.dispose();
      expect(adapter.dispose).toHaveBeenCalledOnce();
    } finally {
      revoke.mockRestore();
    }
  });

  it("preserves a first-frame rejection when engine disposal throws", async () => {
    intercept();
    const firstFrameFailure = new Error("Original first-frame failure");
    const disposalFailure = new Error("Engine disposal failed");
    const terminate = vi.fn();
    vi.stubGlobal(
      "Worker",
      class {
        terminate = terminate;
      },
    );
    const adapter = {
      ...engine(),
      dispose: vi.fn(() => {
        throw disposalFailure;
      }),
    };
    await expect(
      createSessionWithEngine(options(), () =>
        Promise.resolve(async (settings: CreateReplayEngineOptions) => {
          await settings.resources.worker("engine.mjs");
          return { ...adapter, firstFrame: Promise.reject(firstFrameFailure) };
        }),
      ),
    ).rejects.toBe(firstFrameFailure);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("preserves owner cancellation without a throwing abort listener", async () => {
    intercept();
    const abort = new AbortController();
    const reason = new Error("Replay owner closed");
    const terminate = vi.fn();
    vi.stubGlobal(
      "Worker",
      class {
        terminate = terminate;
      },
    );
    const firstFrame = new Promise<void>(() => {
      // Cancellation owns this frame, which will never be presented.
    });
    const barrierRead = vi.fn();
    const adapter = {
      ...engine(firstFrame),
      get firstFrame() {
        barrierRead();
        return firstFrame;
      },
      dispose: vi.fn(() => {
        throw new Error("Engine disposal failed");
      }),
    };
    const pending = createSessionWithEngine(
      { ...options(), signal: abort.signal },
      () =>
        Promise.resolve(async (settings: CreateReplayEngineOptions) => {
          await settings.resources.worker("engine.mjs");
          return adapter;
        }),
    );
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => {
      expect(barrierRead).toHaveBeenCalled();
    });
    abort.abort(reason);
    await rejected;
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });
});

describe("replay session ownership", () => {
  const invalidFirstFrames: {
    reason: string;
    change: Partial<ReplaySessionState>;
  }[] = [
    {
      reason: "partial roster",
      change: { participants: state.participants.slice(0, 1) },
    },
    {
      reason: "duplicate participant IDs",
      change: {
        participants: state.participants.map((player) => ({
          ...player,
          participantId: 0,
        })),
      },
    },
    {
      reason: "unsafe participant ID",
      change: {
        participants: state.participants.map((player, index) =>
          index === 0
            ? { ...player, participantId: Number.MAX_SAFE_INTEGER + 1 }
            : player,
        ),
      },
    },
    {
      reason: "fractional participant ID",
      change: {
        participants: state.participants.map((player, index) =>
          index === 0 ? { ...player, participantId: 0.5 } : player,
        ),
      },
    },
    {
      reason: "negative participant ID",
      change: {
        participants: state.participants.map((player, index) =>
          index === 0 ? { ...player, participantId: -1 } : player,
        ),
      },
    },
    {
      reason: "unbalanced teams",
      change: {
        participants: state.participants.map((player) => ({
          ...player,
          teamId: 100,
        })),
      },
    },
    { reason: "non-finite time", change: { timeSeconds: Number.NaN } },
    { reason: "time outside the replay", change: { timeSeconds: 61 } },
    {
      reason: "non-finite duration",
      change: { durationSeconds: Number.POSITIVE_INFINITY },
    },
    { reason: "non-finite rate", change: { rate: Number.NaN } },
    { reason: "non-positive rate", change: { rate: 0 } },
  ];
  it.each(invalidFirstFrames)(
    "rejects $reason before publishing native readiness",
    async ({ change }) => {
      intercept();
      const adapter = engine(Promise.resolve(), { ...state, ...change });
      await expect(
        createSessionWithEngine(options(), () =>
          Promise.resolve(() => Promise.resolve(adapter)),
        ),
      ).rejects.toMatchObject({ code: "unsupported-capability" });
      expect(adapter.dispose).toHaveBeenCalledOnce();
    },
  );

  it("does not become ready before the real engine's first presentation", async () => {
    intercept();
    let present: (() => void) | undefined;
    const adapter = engine(
      new Promise<void>((resolve) => {
        present = resolve;
      }),
    );
    const factory = vi.fn(() => Promise.resolve(adapter));
    let ready = false;
    const pending = (async () => {
      const result = await createSessionWithEngine(options(), () =>
        Promise.resolve(factory),
      );
      ready = true;
      return result;
    })();
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalledTimes(1);
    });
    expect(ready).toBe(false);
    present?.();
    const session = await pending;
    expect(session.getState()).toEqual(state);
    session.play();
    expect(adapter.play).toHaveBeenCalledOnce();
    session.focusParticipant(0);
    expect(adapter.focusParticipant).toHaveBeenCalledWith(0);
    session.dispose();
    session.dispose();
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(() => session.play()).toThrow();
  });

  it("rejects mismatched replay identities without creating an engine", async () => {
    intercept();
    const altered = replay.slice(0);
    new Uint8Array(altered)[6] = 0;
    const load = vi.fn();
    await expect(
      createSessionWithEngine({ ...options(), replay: altered }, load),
    ).rejects.toMatchObject({ code: "incompatible-build" });
    expect(load).not.toHaveBeenCalled();
  });

  it("abort tears down a waiting renderer and rejects promptly", async () => {
    intercept();
    const abort = new AbortController();
    const adapter = engine(
      new Promise<void>(() => {
        // Intentionally never presents; owner abort must reject independently.
      }),
    );
    const factory = vi.fn(() => Promise.resolve(adapter));
    const pending = createSessionWithEngine(
      { ...options(), signal: abort.signal },
      () => Promise.resolve(factory),
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalledOnce();
    });
    abort.abort();
    await rejected;
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it("disposes an engine that completes after its owner was aborted", async () => {
    intercept();
    const abort = new AbortController();
    let complete: ((value: ReplayEngineSession) => void) | undefined;
    const factory = vi.fn(
      () =>
        new Promise<ReplayEngineSession>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = createSessionWithEngine(
      { ...options(), signal: abort.signal },
      () => Promise.resolve(factory),
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalledOnce();
    });
    abort.abort();
    await rejected;
    const adapter = engine();
    complete?.(adapter);
    await vi.waitFor(() => {
      expect(adapter.dispose).toHaveBeenCalledOnce();
    });
  });

  it("owns a resolved engine before an abort between promise continuations", async () => {
    intercept();
    const abort = new AbortController();
    const adapter = engine();
    const factory = () =>
      new Promise<ReplayEngineSession>((resolve) => {
        queueMicrotask(() => {
          resolve(adapter);
          // Creation reactions run first; the session's awaiting continuation
          // resumes later. Abort exactly between those two ownership steps.
          queueMicrotask(() => {
            abort.abort();
          });
        });
      });
    await expect(
      createSessionWithEngine({ ...options(), signal: abort.signal }, () =>
        Promise.resolve(factory),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});
