import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createActor, waitFor } from "xstate";
import { createDesiredStreamMachine } from "@shepherdjerred/discord-stream-lifecycle";
import type {
  EncoderHandles,
  RawGoLiveDeps,
} from "@shepherdjerred/discord-stream-lifecycle/types";

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
  encoder: EncoderHandles;
  joinTargets: string[];
  gates: {
    join: Deferred<true>;
    run: Deferred<true>;
    leave: Deferred<true>;
  };
};

function makeHarness(): Harness {
  const encoder: EncoderHandles = {
    sink: new PassThrough(),
    output: new PassThrough(),
    playing: Promise.resolve(),
  };
  const gates = {
    join: deferred<true>(),
    run: deferred<true>(),
    leave: deferred<true>(),
  };
  gates.join.resolve(true);
  gates.leave.resolve(true);
  const joinTargets: string[] = [];
  const deps: RawGoLiveDeps = {
    joinVoice: async (input) => {
      joinTargets.push(input.target.channelId);
      await gates.join.promise;
    },
    prepareEncoder: () => Promise.resolve(encoder),
    runStream: async () => {
      await gates.run.promise;
    },
    leaveVoice: async () => {
      await gates.leave.promise;
    },
    retryDelayMs: 10,
  };

  return { deps, encoder, joinTargets, gates };
}

function createHarnessActor(h: Harness) {
  return createActor(createDesiredStreamMachine(h.deps), {
    input: { voiceTarget: { guildId: "guild-1", channelId: "channel-1" } },
  });
}

describe("desired stream machine", () => {
  test("desired=true brings stream up and desired=false takes it down", async () => {
    const h = makeHarness();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    await waitFor(actor, (s) => s.context.frameSink !== null);
    expect(actor.getSnapshot().context.frameSink).toBe(h.encoder.sink);

    actor.send({ type: "SET_DESIRED", desired: false });
    await waitFor(actor, (s) => s.context.frameSink === null);
    expect(actor.getSnapshot().context.desired).toBe(false);
    actor.stop();
  });

  test("flapping while joining converges to final desired=true", async () => {
    const h = makeHarness();
    h.gates.join = deferred<true>();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    actor.send({ type: "SET_DESIRED", desired: false });
    actor.send({ type: "SET_DESIRED", desired: true });
    h.gates.join.resolve(true);

    await waitFor(actor, (s) => s.context.frameSink !== null, {
      timeout: 2000,
    });
    expect(actor.getSnapshot().context.desired).toBe(true);
    actor.stop();
  });

  test("START during teardown converges back to streaming", async () => {
    const h = makeHarness();
    h.gates.leave = deferred<true>();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    await waitFor(actor, (s) => s.context.frameSink !== null);

    actor.send({ type: "SET_DESIRED", desired: false });
    await waitFor(actor, (s) => s.context.frameSink === null);
    actor.send({ type: "SET_DESIRED", desired: true });

    h.gates.leave.resolve(true);
    await waitFor(actor, (s) => s.context.frameSink !== null, {
      timeout: 2000,
    });
    expect(actor.getSnapshot().context.desired).toBe(true);
    actor.stop();
  });

  test("VOICE_TARGET_MOVED forwarded during teardown rejoins the new channel", async () => {
    const h = makeHarness();
    h.gates.leave = deferred<true>();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    await waitFor(actor, (s) => s.context.frameSink !== null);
    expect(h.joinTargets).toEqual(["channel-1"]);

    // Begin teardown (leave gated open), then move the target while the child is stopping.
    actor.send({ type: "SET_DESIRED", desired: false });
    await waitFor(actor, (s) => s.context.frameSink === null);
    actor.send({
      type: "VOICE_TARGET_MOVED",
      target: { guildId: "guild-1", channelId: "channel-2" },
    });
    actor.send({ type: "SET_DESIRED", desired: true });

    // Finish teardown — the reconciler restarts and must join the NEW channel, not the stale one.
    h.gates.leave.resolve(true);
    await waitFor(actor, (s) => s.context.frameSink !== null, {
      timeout: 2000,
    });
    expect(actor.getSnapshot().context.voiceTarget.channelId).toBe("channel-2");
    expect(h.joinTargets.at(-1)).toBe("channel-2");
    actor.stop();
  });

  test("external detach terminates and clears desired state", async () => {
    const h = makeHarness();
    const actor = createHarnessActor(h);
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    await waitFor(actor, (s) => s.context.frameSink !== null);
    actor.send({ type: "STREAMER_VOICE_DETACHED", reason: "kicked" });

    await waitFor(actor, (s) => s.context.teardownReason === "voiceDetached");
    expect(actor.getSnapshot().context.desired).toBe(false);
    expect(actor.getSnapshot().context.frameSink).toBeNull();
    actor.stop();
  });
});
