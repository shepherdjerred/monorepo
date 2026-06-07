import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createActor, waitFor } from "xstate";
import {
  createStreamMachine,
  type EncoderHandles,
  type StreamMachineDeps,
} from "./stream-machine.ts";

// Resolves with a sentinel `true` rather than `void` — the repo's
// no-invalid-void-type rule rejects `void` as a generic type argument.
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
  deps: StreamMachineDeps;
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

// Builds deps whose every side effect is gated on a deferred the test resolves,
// so we can freeze the machine in any state and observe ordering. Defaults:
// join/prepare/leave auto-resolve, run stays pending (so we settle in
// `streaming` until explicitly told otherwise).
function makeHarness(
  overrides: Partial<
    Pick<StreamMachineDeps, "maxRetries" | "retryDelayMs">
  > = {},
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

  const deps: StreamMachineDeps = {
    joinVoice: async (signal) => {
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
    maxRetries: overrides.maxRetries ?? 3,
    retryDelayMs: overrides.retryDelayMs ?? 20,
  };

  return { deps, calls, encoder, gates, signals };
}

describe("stream machine", () => {
  test("happy path: idle → streaming → idle, with frame sink wired only while streaming", async () => {
    const h = makeHarness();
    const actor = createActor(createStreamMachine(h.deps));
    actor.start();

    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.frameSink).toBeNull();

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

  test("frame sink is non-null ONLY in the streaming state", async () => {
    const h = makeHarness();
    // Keep join pending so we can observe `starting` with no sink.
    h.gates.join = deferred<true>();
    const actor = createActor(createStreamMachine(h.deps));

    const sinkByState = new Map<string, boolean>();
    actor.subscribe((s) => {
      const value =
        typeof s.value === "string" ? s.value : JSON.stringify(s.value);
      sinkByState.set(value, s.context.frameSink !== null);
    });
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("starting"));
    expect(actor.getSnapshot().context.frameSink).toBeNull();

    h.gates.join.resolve(true);
    await waitFor(actor, (s) => s.matches("streaming"));
    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("idle"));

    // Only `streaming` ever observed a non-null sink.
    for (const [state, hadSink] of sinkByState) {
      expect(hadSink).toBe(state === "streaming");
    }
    actor.stop();
  });

  test("STOP during voice join aborts and never reaches streaming", async () => {
    const h = makeHarness();
    h.gates.join = deferred<true>(); // join stays pending
    const actor = createActor(createStreamMachine(h.deps));
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("starting"));

    actor.send({ type: "STOP" });
    // The in-flight join is aborted by the actor's signal.
    expect(h.signals.join?.aborted).toBe(true);

    await waitFor(actor, (s) => s.matches("idle"));
    expect(h.calls).not.toContain("prepareEncoder");
    expect(h.calls).not.toContain("runStream");
    expect(h.calls).toContain("leaveVoice"); // best-effort cleanup
    expect(actor.getSnapshot().context.frameSink).toBeNull();
    actor.stop();
  });

  test("voice join failure goes to failed then retries", async () => {
    const h = makeHarness({ maxRetries: 2, retryDelayMs: 10 });
    let attempts = 0;
    h.deps.joinVoice = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("voice join failed");
      // second attempt succeeds
    };
    const actor = createActor(createStreamMachine(h.deps));
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.lastError).toBe("voice join failed");

    // Bounded retry kicks in and the second attempt streams.
    await waitFor(actor, (s) => s.matches("streaming"), { timeout: 2000 });
    expect(attempts).toBe(2);
    // retries reset once streaming is healthy.
    expect(actor.getSnapshot().context.retries).toBe(0);
    actor.stop();
  });

  test("retries are bounded then fall back to idle", async () => {
    const h = makeHarness({ maxRetries: 2, retryDelayMs: 5 });
    h.deps.joinVoice = () => Promise.reject(new Error("always fails"));
    const actor = createActor(createStreamMachine(h.deps));
    actor.start();

    actor.send({ type: "START" });
    // After exhausting the retry budget it gives up to idle.
    await waitFor(
      actor,
      (s) => s.matches("idle") && s.context.lastError === null,
      { timeout: 2000 },
    );
    actor.stop();
  });

  test("an unexpected stream end is treated as a failure (reconnect path)", async () => {
    const h = makeHarness({ maxRetries: 1, retryDelayMs: 1000 });
    const actor = createActor(createStreamMachine(h.deps));
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("streaming"));

    // runStream resolving on its own means the broadcast died.
    h.gates.run.resolve(true);
    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.lastError).toBe(
      "stream ended unexpectedly",
    );
    actor.stop();
  });

  test("STOP cancels a pending reconnect", async () => {
    const h = makeHarness({ maxRetries: 5, retryDelayMs: 10_000 });
    h.deps.joinVoice = () => Promise.reject(new Error("boom"));
    const actor = createActor(createStreamMachine(h.deps));
    actor.start();

    actor.send({ type: "START" });
    await waitFor(actor, (s) => s.matches("failed"));

    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("idle"));
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });
});
