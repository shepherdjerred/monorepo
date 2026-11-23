import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createResearchReplaySession } from "./research.ts";
import type { ReplaySessionState } from "./types.ts";

function researchEngine(durationSeconds = 120, maximumDecodedSeconds = 120) {
  const state: ReplaySessionState = {
    timeSeconds: 0,
    durationSeconds,
    playing: false,
    rate: 1,
    perspective: "all",
    camera: { mode: "free" },
    participants: [],
  };
  return {
    firstFrame: Promise.resolve(),
    capabilities: {
      gameBuild: "16.21.829.8620",
      mapId: 12,
      fidelity: "verified-partial",
      maximumDecodedSeconds,
    },
    getState: () => state,
    subscribe: vi.fn(() => ignoreUnsubscribe),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(() => Promise.resolve()),
    setRate: vi.fn(),
    setCamera: vi.fn(),
    focusParticipant: vi.fn(),
    setPerspective: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}
function ignoreUnsubscribe(): void {
  // Controlled contract adapter owns no actual DOM subscriptions.
}
function options() {
  const canvas = z
    .custom<HTMLCanvasElement>(
      (value) =>
        typeof value === "object" && value !== null && "parentElement" in value,
    )
    .parse({ parentElement: {} });
  return {
    canvas,
    replay: new ArrayBuffer(0),
    assetBase: "https://scout.invalid/assets/",
    staticRootSha256: "a".repeat(64),
    replayDurationSeconds: 120,
  };
}

it("preserves a fatal error between first presentation and the readiness continuation", async () => {
  const adapter = researchEngine();
  let present: (() => void) | undefined;
  let fail: ((cause: unknown) => void) | undefined;
  adapter.firstFrame = new Promise<void>((resolve) => {
    present = resolve;
  });
  const cause = new Error("Worker failed at the first-presentation boundary");
  const pending = createResearchReplaySession({
    ...options(),
    loadEngine: () =>
      Promise.resolve({
        createLatestViewerEngine: (settings: {
          onError: (cause: unknown) => void;
        }) => {
          fail = settings.onError;
          return adapter;
        },
      }),
  });
  const rejected = expect(pending).rejects.toMatchObject({
    code: "engine-failed",
    cause,
  });
  await vi.waitFor(() => {
    expect(fail).toBeTypeOf("function");
  });
  present?.();
  queueMicrotask(() => {
    fail?.(cause);
  });
  await rejected;
  expect(adapter.dispose).toHaveBeenCalledOnce();
});

describe("research replay window readiness", () => {
  it("reads the selected map capability only after its actual first presentation", async () => {
    const adapter = researchEngine();
    let presented = false;
    let present: (() => void) | undefined;
    adapter.firstFrame = new Promise<void>((resolve) => {
      present = () => {
        presented = true;
        resolve();
      };
    });
    Object.defineProperty(adapter.capabilities, "mapId", {
      get: () => {
        if (!presented) throw new Error("Selected scene has not loaded");
        return 11;
      },
    });
    const factory = vi.fn(() => adapter);
    const pending = createResearchReplaySession({
      ...options(),
      loadEngine: () => Promise.resolve({ createLatestViewerEngine: factory }),
    });
    const rejected = vi.fn();
    const observeFailure = async () => {
      try {
        await pending;
      } catch (error) {
        rejected(error);
      }
    };
    void observeFailure();
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalledOnce();
    });
    expect(presented).toBe(false);
    expect(rejected).not.toHaveBeenCalled();
    expect(adapter.dispose).not.toHaveBeenCalled();
    present?.();
    const session = await pending;
    expect(session.getState().durationSeconds).toBe(120);
    session.dispose();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
  it("reports late research failures with original cause and tears down subscriptions", async () => {
    const adapter = researchEngine(),
      listener = vi.fn();
    let fail: ((cause: unknown) => void) | undefined;
    const session = await createResearchReplaySession({
      ...options(),
      loadEngine: () =>
        Promise.resolve({
          createLatestViewerEngine: (settings: {
            onError: (cause: unknown) => void;
          }) => {
            fail = settings.onError;
            return adapter;
          },
        }),
    });
    session.subscribeErrors(listener);
    session.subscribe(vi.fn());
    const cause = new Error("Research worker lost its graphics resource");
    fail?.(cause);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "engine-failed",
        message: cause.message,
        cause,
      }),
    );
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(() => session.play()).toThrow(cause.message);
    session.dispose();
    fail?.(new Error("Stale callback"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("preserves synchronous startup failure while disposing its returned renderer", async () => {
    const adapter = researchEngine(),
      cause = new Error("Research startup failed");
    await expect(
      createResearchReplaySession({
        ...options(),
        loadEngine: () =>
          Promise.resolve({
            createLatestViewerEngine: (settings: {
              onError: (cause: unknown) => void;
            }) => {
              settings.onError(cause);
              return adapter;
            },
          }),
      }),
    ).rejects.toMatchObject({ code: "engine-failed", cause });
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
  it("defaults to the entire declared original match rather than a fixed preview", async () => {
    const adapter = researchEngine(3023.2, 3023.2);
    const factory = vi.fn(() => adapter);
    const session = await createResearchReplaySession({
      ...options(),
      replayDurationSeconds: 3023.2,
      loadEngine: () => Promise.resolve({ createLatestViewerEngine: factory }),
    });
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ endTime: 3023.2 }),
    );
    expect(session.getState().durationSeconds).toBe(3023.2);
    await session.seek(3000);
    expect(adapter.seek).toHaveBeenCalledWith(3000);
    session.dispose();
  });

  it("retains the observed whole-container float32 tail within the declared millisecond", async () => {
    const originalPacketEnd = 1553.143310546875;
    const adapter = researchEngine(originalPacketEnd, 1553.143);
    const session = await createResearchReplaySession({
      ...options(),
      replayDurationSeconds: 1553.143,
      loadEngine: () =>
        Promise.resolve({ createLatestViewerEngine: () => adapter }),
    });
    expect(session.getState().durationSeconds).toBe(originalPacketEnd);
    await session.seek(originalPacketEnd);
    expect(adapter.seek).toHaveBeenCalledWith(originalPacketEnd);
    session.dispose();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 121])(
    "rejects invalid or out-of-container decoded windows %s",
    async (decodedSeconds) => {
      const factory = vi.fn();
      await expect(
        createResearchReplaySession({
          ...options(),
          decodedSeconds,
          loadEngine: () =>
            Promise.resolve({ createLatestViewerEngine: factory }),
        }),
      ).rejects.toMatchObject({ code: "unsupported-capability" });
      expect(factory).not.toHaveBeenCalled();
    },
  );
  it.each([60, 119.9, 121, Number.NaN])(
    "disposes a first frame with mismatched presented duration %s",
    async (duration) => {
      const adapter = researchEngine(duration);
      await expect(
        createResearchReplaySession({
          ...options(),
          loadEngine: () =>
            Promise.resolve({ createLatestViewerEngine: () => adapter }),
        }),
      ).rejects.toMatchObject({ code: "unsupported-capability" });
      expect(adapter.dispose).toHaveBeenCalledOnce();
    },
  );

  it.each([60, Number.NaN])(
    "rejects declared decode coverage %s before first presentation",
    async (maximum) => {
      const adapter = researchEngine(120, maximum);
      await expect(
        createResearchReplaySession({
          ...options(),
          loadEngine: () =>
            Promise.resolve({ createLatestViewerEngine: () => adapter }),
        }),
      ).rejects.toMatchObject({ code: "unsupported-capability" });
      expect(adapter.dispose).toHaveBeenCalledOnce();
    },
  );

  it("keeps exact requested duration and original seek ownership", async () => {
    const adapter = researchEngine(119.876, 120);
    const session = await createResearchReplaySession({
      ...options(),
      decodedSeconds: 119.876,
      loadEngine: () =>
        Promise.resolve({ createLatestViewerEngine: () => adapter }),
    });
    await session.seek(119.876);
    session.focusParticipant(0);
    expect(adapter.seek).toHaveBeenCalledWith(119.876);
    expect(adapter.focusParticipant).toHaveBeenCalledWith(0);
    expect(session.getState().durationSeconds).toBe(119.876);
    session.dispose();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });
});
