import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createActor, waitFor } from "xstate";
import { createOrchestratorMachine } from "./orchestrator-machine.ts";
import type { EncoderHandles, StreamMachineDeps } from "./stream-machine.ts";

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
  encoder: EncoderHandles;
  gates: {
    join: Deferred<true>;
    run: Deferred<true>;
    leave: Deferred<true>;
  };
};

// join/leave auto-resolve by default (override the gate to make them pending);
// run stays pending so the orchestrator settles in `streaming`.
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

  const deps: StreamMachineDeps = {
    joinVoice: () => gates.join.promise,
    prepareEncoder: () => Promise.resolve(encoder),
    runStream: () => gates.run.promise,
    leaveVoice: () => gates.leave.promise,
    maxRetries: 3,
    retryDelayMs: 10,
  };

  return { deps, encoder, gates };
}

describe("orchestrator machine", () => {
  test("desired=true brings the stream up; desired=false takes it down", async () => {
    const h = makeHarness();
    const actor = createActor(createOrchestratorMachine(h.deps));
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    await waitFor(actor, (s) => s.context.frameSink !== null);
    expect(actor.getSnapshot().context.frameSink).toBe(h.encoder.sink);

    actor.send({ type: "SET_DESIRED", desired: false });
    await waitFor(actor, (s) => s.context.frameSink === null);
    actor.stop();
  });

  test("flapping true→false→true while joining converges to streaming", async () => {
    const h = makeHarness();
    h.gates.join = deferred<true>(); // hold the join so events interleave mid-start
    const actor = createActor(createOrchestratorMachine(h.deps));
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

  test("a START arriving during teardown converges back to streaming", async () => {
    const h = makeHarness();
    h.gates.leave = deferred<true>(); // hold teardown so START lands mid-stopping
    const actor = createActor(createOrchestratorMachine(h.deps));
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    await waitFor(actor, (s) => s.context.frameSink !== null);

    // Begin teardown, then immediately ask for it back up.
    actor.send({ type: "SET_DESIRED", desired: false });
    await waitFor(actor, (s) => s.context.frameSink === null);
    actor.send({ type: "SET_DESIRED", desired: true });

    // Let teardown finish; the orchestrator must re-establish the stream.
    h.gates.leave.resolve(true);
    await waitFor(actor, (s) => s.context.frameSink !== null, {
      timeout: 2000,
    });
    expect(actor.getSnapshot().context.desired).toBe(true);
    actor.stop();
  });

  test("a settle while undesired stays down (no spurious restart)", async () => {
    const h = makeHarness();
    const actor = createActor(createOrchestratorMachine(h.deps));
    actor.start();

    actor.send({ type: "SET_DESIRED", desired: true });
    await waitFor(actor, (s) => s.context.frameSink !== null);
    actor.send({ type: "SET_DESIRED", desired: false });
    await waitFor(actor, (s) => s.context.frameSink === null);

    // Give the machine room to (incorrectly) restart, then assert it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(actor.getSnapshot().context.frameSink).toBeNull();
    expect(actor.getSnapshot().context.desired).toBe(false);
    actor.stop();
  });
});
