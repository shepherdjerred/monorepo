import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createActor, waitFor } from "xstate";
import { createRawGoLiveMachine } from "@shepherdjerred/discord-stream-lifecycle";
import type {
  EncoderHandles,
  RawGoLiveDeps,
} from "@shepherdjerred/discord-stream-lifecycle/types.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Harness = {
  deps: RawGoLiveDeps;
  calls: string[];
  encoder: EncoderHandles;
  gates: {
    join: Deferred<true>;
    prepare: Deferred<EncoderHandles>;
    run: Deferred<true>;
    leave: Deferred<true>;
  };
  signals: { join?: AbortSignal };
};

function makeHarness(
  overrides: Partial<Pick<RawGoLiveDeps, "retryDelayMs">> & {
    readonly maxRetries?: number;
  } = {},
): Harness {
  const calls: string[] = [];
  const sink = new PassThrough();
  const encoder: EncoderHandles = {
    sink,
    output: new PassThrough(),
    playing: Promise.resolve(),
  };
  const gates = {
    join: deferred<true>(),
    prepare: deferred<EncoderHandles>(),
    run: deferred<true>(),
    leave: deferred<true>(),
  };
  gates.join.resolve(true);
  gates.prepare.resolve(encoder);
  gates.leave.resolve(true);
  const signals: { join?: AbortSignal } = {};

  const deps: RawGoLiveDeps = {
    joinVoice: async (_input, signal) => {
      calls.push("joinVoice");
      signals.join = signal;
      await gates.join.promise;
    },
    prepareEncoder: async () => {
      calls.push("prepareEncoder");
      return gates.prepare.promise;
    },
    runStream: async () => {
      calls.push("runStream");
      await gates.run.promise;
    },
    leaveVoice: async () => {
      calls.push("leaveVoice");
      await gates.leave.promise;
    },
    retryDelayMs: overrides.retryDelayMs ?? 20,
  };

  return { deps, calls, encoder, gates, signals };
}

function createHarnessActor(h: Harness, maxRetries = 3) {
  return createActor(createRawGoLiveMachine(h.deps), {
    input: {
      voiceTarget: { guildId: "guild-1", channelId: "channel-1" },
      maxRetries,
    },
  });
}

describe("raw Go-Live machine", () => {
  test("happy path reaches streaming and stops back to idle", async () => {
    const h = makeHarness();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("streaming"));

    expect(actor.getSnapshot().context.frameSink).toBe(h.encoder.sink);
    expect(h.calls).toEqual(["joinVoice", "prepareEncoder", "runStream"]);

    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("idle"));

    expect(actor.getSnapshot().context.frameSink).toBeNull();
    expect(h.calls).toContain("leaveVoice");
    actor.stop();
  });

  test("STOP during voice join aborts and never reaches streaming", async () => {
    const h = makeHarness();
    h.gates.join = deferred<true>();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("joining"));
    actor.send({ type: "STOP" });

    expect(h.signals.join?.aborted).toBe(true);
    await waitFor(actor, (s) => s.matches("idle"));
    expect(h.calls).not.toContain("prepareEncoder");
    expect(h.calls).not.toContain("runStream");
    actor.stop();
  });

  test("join failure retries within the configured budget", async () => {
    const h = makeHarness({ retryDelayMs: 5 });
    let attempts = 0;
    h.deps = {
      ...h.deps,
      joinVoice: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("voice join failed");
        }
      },
    };
    const actor = createHarnessActor(h, 2);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.lastError).toBe("voice join failed");

    await waitFor(actor, (s) => s.matches("streaming"), { timeout: 2000 });
    expect(attempts).toBe(2);
    expect(actor.getSnapshot().context.retries).toBe(0);
    actor.stop();
  });

  test("unexpected stream end enters reconnect path", async () => {
    const h = makeHarness({ retryDelayMs: 1000 });
    const actor = createHarnessActor(h, 1);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("streaming"));
    h.gates.run.resolve(true);

    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.lastError).toBe(
      "stream ended unexpectedly",
    );
    actor.stop();
  });

  test("external voice detach terminates instead of retrying", async () => {
    const h = makeHarness();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("streaming"));
    actor.send({ type: "STREAMER_VOICE_DETACHED", reason: "kicked" });

    await waitFor(actor, (s) => s.matches("terminated"));
    expect(actor.getSnapshot().context.teardownReason).toBe("voiceDetached");
    expect(actor.getSnapshot().context.frameSink).toBeNull();
    actor.stop();
  });

  test("admin move updates voice target and restarts from idle when desired externally", async () => {
    const h = makeHarness();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({
      type: "VOICE_TARGET_MOVED",
      target: { guildId: "guild-1", channelId: "channel-2" },
    });

    expect(actor.getSnapshot().context.voiceTarget.channelId).toBe("channel-2");
    actor.stop();
  });

  test("START while failed respects the retry budget instead of bypassing it", async () => {
    // maxRetries=1: one auto-retry allowed. After it fails, retries reaches the cap, so a manual START
    // (e.g. a forwarded SET_DESIRED:true) must give up to idle rather than jumping back to joining and
    // bypassing canRetry.
    const h = makeHarness({ retryDelayMs: 1000 });
    h.deps = {
      ...h.deps,
      joinVoice: () => Promise.reject(new Error("voice join failed")),
    };
    const actor = createHarnessActor(h, 1);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.retries).toBe(1);
    expect(actor.getSnapshot().context.retries).toBe(
      actor.getSnapshot().context.maxRetries,
    );

    // Budget is exhausted — a manual START must not re-enter joining.
    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("idle"));
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });

  test("START while failed retries when budget remains", async () => {
    const h = makeHarness({ retryDelayMs: 1000 });
    let attempts = 0;
    h.deps = {
      ...h.deps,
      joinVoice: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("voice join failed");
        }
      },
    };
    const actor = createHarnessActor(h, 2);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.retries).toBe(1);

    // Budget remains (1 < 2): a manual START retries immediately without waiting for retryDelay.
    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("streaming"));
    expect(attempts).toBe(2);
    actor.stop();
  });

  test("VOICE_TARGET_MOVED during teardown keeps the new target for the next join", async () => {
    const h = makeHarness();
    h.gates.leave = deferred<true>();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("streaming"));

    // STOP enters stopping (a non-terminal teardown), leaveVoice is gated open.
    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("stopping"));

    // A move arriving mid-teardown must update the target rather than being dropped.
    actor.send({
      type: "VOICE_TARGET_MOVED",
      target: { guildId: "guild-1", channelId: "channel-9" },
    });
    expect(actor.getSnapshot().context.voiceTarget.channelId).toBe("channel-9");

    // Finish teardown → idle, then start again: it must join the NEW channel.
    h.gates.leave.resolve(true);
    await waitFor(actor, (s) => s.matches("idle"));
    expect(actor.getSnapshot().context.voiceTarget.channelId).toBe("channel-9");
    actor.stop();
  });

  test("VOICE_TARGET_MOVED during a terminal teardown does not divert it from terminated", async () => {
    const h = makeHarness();
    h.gates.leave = deferred<true>();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("streaming"));

    // A terminal teardown (detach) enters stopping with teardownReason=voiceDetached.
    actor.send({ type: "STREAMER_VOICE_DETACHED", reason: "kicked" });
    await waitFor(actor, (s) => s.matches("stopping"));

    // The move must update voiceTarget WITHOUT clobbering the in-flight teardownReason — otherwise
    // stopping's onDone would route to idle instead of terminated.
    actor.send({
      type: "VOICE_TARGET_MOVED",
      target: { guildId: "guild-1", channelId: "channel-9" },
    });
    expect(actor.getSnapshot().context.voiceTarget.channelId).toBe("channel-9");
    expect(actor.getSnapshot().context.teardownReason).toBe("voiceDetached");

    h.gates.leave.resolve(true);
    await waitFor(actor, (s) => s.matches("terminated"));
    actor.stop();
  });
});
