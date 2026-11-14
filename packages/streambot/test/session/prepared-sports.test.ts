import { describe, expect, it, vi } from "vitest";
import { runWithPreparedSportsInput } from "@shepherdjerred/streambot/sources/prepared-sports.ts";
import type { RunStreamInput } from "@shepherdjerred/streambot/machine/types.ts";
import { SportsPlaybackError } from "@shepherdjerred/streambot/sports/failures.ts";
import {
  initialPlaybackContext,
  queueCrashRetryUpdates,
  RESOLVE_TIMEOUT_MS,
} from "@shepherdjerred/streambot/machine/playback-helpers.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const recipe = { sourceUrl: "https://v2.streameast.ga/nba/fixture/" };
function input(): RunStreamInput {
  return {
    voice: {
      guildId: GuildIdSchema.parse("100000000000000001"),
      channelId: ChannelIdSchema.parse("100000000000000002"),
    },
    volume: 100,
    seekSeconds: 0,
    pipelineMode: "sw",
    resolved: {
      title: "Fixture",
      mediaKind: "video",
      live: true,
      chapters: [],
      sportsRecipe: recipe,
    },
  };
}

describe("sports preparation budget and metadata", () => {
  it("bounds deferred preparation without entering playback", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const pending = runWithPreparedSportsInput(
        input(),
        new AbortController().signal,
        (_recipe, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => {
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error("preparation aborted"),
                );
              },
              { once: true },
            ),
          ),
        run,
      );
      const failed = expect(pending).rejects.toMatchObject({
        kind: "provider-session",
      });
      await vi.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS);
      await failed;
      expect(run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the preparation deadline before a long-lived lease starts streaming", async () => {
    vi.useFakeTimers();
    try {
      const entered = Promise.withResolvers<true>();
      const done = Promise.withResolvers<true>();
      let preparationSignal: AbortSignal | undefined;
      const pending = runWithPreparedSportsInput(
        input(),
        new AbortController().signal,
        async (_recipe, signal) => {
          preparationSignal = signal;
          return {
            title: "Fixture",
            input: "http://127.0.0.1/fresh",
            headers: {},
            close: () => Promise.resolve(),
          };
        },
        async () => {
          entered.resolve(true);
          await done.promise;
        },
      );
      await entered.promise;
      await vi.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS + 1);
      expect(preparationSignal?.aborted).toBe(false);
      done.resolve(true);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([false, true])(
    "uses freshly probed HDR=%s after switching feeds",
    async (hdr) => {
      const request = input();
      const prepare = async () => ({
        title: "Replacement feed",
        input: "http://127.0.0.1/fresh",
        headers: {},
        hdr,
        close: () => Promise.resolve(),
      });
      await runWithPreparedSportsInput(
        { ...request, resolved: { ...request.resolved, hdr: !hdr } },
        new AbortController().signal,
        prepare,
        async ({ resolved }) => {
          expect(resolved.hdr).toBe(hdr);
        },
      );
    },
  );
});

describe("sports playback input lifetime", () => {
  it.each(["session-expired", "unsupported-format"] as const)(
    "aborts and drains playback before closing a failed provider session (%s)",
    async (kind) => {
      const failure = Promise.withResolvers<never>();
      const events: string[] = [];
      const prepare = async () => ({
        title: "Fixture",
        input: "http://127.0.0.1/input",
        headers: {},
        failure: failure.promise,
        close: async () => {
          events.push("closed");
        },
      });
      const run = async (_request: RunStreamInput, signal: AbortSignal) => {
        const drained = new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              events.push("drained");
              resolve();
            },
            { once: true },
          ),
        );
        failure.reject(new SportsPlaybackError(kind));
        await drained;
      };
      await expect(
        runWithPreparedSportsInput(
          input(),
          new AbortController().signal,
          prepare,
          run,
        ),
      ).rejects.toMatchObject({
        kind: "provider-session",
        pipelineMode: "sw",
        positionSeconds: 0,
      });
      expect(events).toEqual(["drained", "closed"]);
    },
  );

  it("keeps unsupported-format terminal when no candidate could prepare", async () => {
    const run = vi.fn();
    await expect(
      runWithPreparedSportsInput(
        input(),
        new AbortController().signal,
        async () => {
          throw new SportsPlaybackError("unsupported-format");
        },
        run,
      ),
    ).rejects.toMatchObject({
      name: "SportsPlaybackError",
      kind: "unsupported-format",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("charges provider retries to the bounded budget without advancing the hardware pipeline", () => {
    const request = input();
    const context = {
      ...initialPlaybackContext({ ...request.voice, idleTimeoutMs: 1000 }),
      current: {
        source: { kind: "url" as const, url: recipe.sourceUrl },
        requesterId: UserIdSchema.parse("100000000000000003"),
      },
      resolved: request.resolved,
    };
    const first = queueCrashRetryUpdates(context, {
      reason: "provider-session",
      positionSeconds: 0,
    });
    expect(first).toMatchObject({
      crashRetries: 1,
      pipelineRetries: 0,
      crashNotice: { pipelineMode: "hw", live: true },
    });
    const second = queueCrashRetryUpdates(
      { ...context, ...first },
      { reason: "provider-session", positionSeconds: 0 },
    );
    expect(second).toMatchObject({
      crashRetries: 2,
      pipelineRetries: 0,
      crashNotice: { pipelineMode: "hw" },
    });
    const third = queueCrashRetryUpdates(
      { ...context, ...second },
      { reason: "crash", positionSeconds: 0 },
    );
    expect(third).toMatchObject({
      crashRetries: 3,
      pipelineRetries: 1,
      crashNotice: { pipelineMode: "hw" },
    });
  });
  it("opens fresh private inputs for each attempt and releases them after playback", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    let attempt = 0;
    const prepare = vi.fn(async () => ({
      title: "Fixture",
      input: `http://127.0.0.1/${String(++attempt)}/video`,
      headers: {},
      audioInput: "http://127.0.0.1/audio",
      audioInputOptions: ["-cenc_decryption_key", "synthetic-key"],
      close,
    }));
    const seen: string[] = [];
    const run = vi.fn(async (request: RunStreamInput) => {
      expect(request.resolved.ffmpegInput).toBeDefined();
      seen.push(request.resolved.ffmpegInput ?? "missing");
      expect(request.resolved.audioInputOptions).toEqual([
        "-cenc_decryption_key",
        "synthetic-key",
      ]);
      expect("sportsRecipe" in request.resolved).toBe(false);
    });
    await runWithPreparedSportsInput(
      input(),
      new AbortController().signal,
      prepare,
      run,
    );
    await runWithPreparedSportsInput(
      input(),
      new AbortController().signal,
      prepare,
      run,
    );
    expect(seen).toEqual([
      "http://127.0.0.1/1/video",
      "http://127.0.0.1/2/video",
    ]);
    expect(close).toHaveBeenCalledTimes(2);
    expect(input().resolved.ffmpegInput).toBeUndefined();
  });

  it("releases private resources when playback throws", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const prepare = async () => ({
      title: "Fixture",
      input: "http://127.0.0.1/input",
      headers: {},
      close,
    });
    await expect(
      runWithPreparedSportsInput(
        input(),
        new AbortController().signal,
        prepare,
        async () => {
          throw new Error("decode failed");
        },
      ),
    ).rejects.toThrow("decode failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a session acquired concurrently with cancellation without starting playback", async () => {
    const abort = new AbortController();
    const close = vi.fn().mockResolvedValue(undefined);
    const prepare = async () => {
      abort.abort(new Error("stopped"));
      return {
        title: "Fixture",
        input: "http://127.0.0.1/input",
        headers: {},
        close,
      };
    };
    const run = vi.fn().mockResolvedValue(undefined);
    await expect(
      runWithPreparedSportsInput(input(), abort.signal, prepare, run),
    ).rejects.toThrow("stopped");
    expect(run).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not allocate resources for an already cancelled invocation", async () => {
    const prepare = vi.fn();
    await expect(
      runWithPreparedSportsInput(
        input(),
        AbortSignal.abort(new Error("skipped")),
        prepare,
        vi.fn(),
      ),
    ).rejects.toThrow("skipped");
    expect(prepare).not.toHaveBeenCalled();
  });
});
