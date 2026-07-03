import { describe, expect, test } from "bun:test";
import { assign, createActor, fromPromise, setup, waitFor } from "xstate";
import { createTransitionLogInspector } from "@shepherdjerred/discord-stream-lifecycle/debug/transition-logger.ts";
import type { TransitionLogSink } from "@shepherdjerred/discord-stream-lifecycle/debug/transition-logger.ts";

type LoggedLine = { message: string; meta: Record<string, unknown> };

function deferred(): {
  promise: Promise<string>;
  resolve: (value: string) => void;
} {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// A tiny machine with:
// - a transient `always` state (`transient`) that `subscribe()` would hide,
// - a gated `fromPromise` child actor (must produce no transition lines),
// - a no-op self-transition on `active` (PING; must produce no line), and
// - a final state.
function buildHarness(gatePromise: Promise<string>) {
  const machineTypes: {
    context: { n: number };
    events: { type: "GO" } | { type: "PING" };
  } = {
    context: { n: 0 },
    events: { type: "GO" },
  };

  return setup({
    types: machineTypes,
    actors: {
      child: fromPromise(() => gatePromise),
    },
  }).createMachine({
    id: "test",
    initial: "idle",
    context: { n: 0 },
    states: {
      idle: { on: { GO: "transient" } },
      transient: { always: "active" },
      active: {
        invoke: { src: "child", onDone: "finished" },
        on: {
          PING: { actions: assign({ n: ({ context }) => context.n + 1 }) },
        },
      },
      finished: { type: "final" },
    },
  });
}

function projectContext(context: unknown): Record<string, unknown> {
  if (
    typeof context === "object" &&
    context !== null &&
    "n" in context &&
    typeof context.n === "number"
  ) {
    return { n: context.n };
  }
  return {};
}

async function run(): Promise<LoggedLine[]> {
  const lines: LoggedLine[] = [];
  const log: TransitionLogSink = {
    info: (message, meta) => {
      lines.push({ message, meta: meta ?? {} });
    },
  };
  const gate = deferred();
  const actor = createActor(buildHarness(gate.promise), {
    inspect: createTransitionLogInspector({
      log,
      label: "test:1",
      projectContext,
    }),
  });
  actor.start();
  actor.send({ type: "GO" }); // idle -> transient (always) -> active
  actor.send({ type: "PING" }); // active -> active (no state change, suppressed)
  actor.send({ type: "PING" }); // active -> active (no state change, suppressed)
  gate.resolve("done"); // active -> finished (child onDone)
  await waitFor(actor, (snapshot) => snapshot.status === "done");
  return lines;
}

function transitions(
  lines: LoggedLine[],
): { from: unknown; to: unknown; event: unknown }[] {
  return lines
    .filter((line) => line.message === "state machine transition")
    .map((line) => ({
      from: line.meta["from"],
      to: line.meta["to"],
      event: line.meta["event"],
    }));
}

describe("createTransitionLogInspector", () => {
  test("logs the transient `always` state that subscribe() would hide", async () => {
    const steps = transitions(await run());
    // The `transient` state is entered and left via `always` in the same step, so it never
    // appears in subscribe()/snapshots — but microstep inspection must surface both hops.
    expect(steps).toContainEqual({
      from: "idle",
      to: "transient",
      event: "GO",
    });
    expect(steps).toContainEqual({
      from: "transient",
      to: "active",
      event: "GO",
    });
  });

  test("records from/to/event for a real transition, including invoked-child completion", async () => {
    const steps = transitions(await run());
    const finish = steps.find((step) => step.to === "finished");
    expect(finish).toBeDefined();
    expect(finish?.from).toBe("active");
    // The child's completion is the machine's transition reason.
    expect(String(finish?.event)).toStartWith("xstate.done.actor");
  });

  test("suppresses no-op self-transitions (PING keeps state active -> no line)", async () => {
    const steps = transitions(await run());
    const pings = steps.filter(
      (step) =>
        step.from === "active" && step.to === "active" && step.event === "PING",
    );
    expect(pings).toHaveLength(0);
  });

  test("does not emit transition lines for fromPromise child actors", async () => {
    const lines = await run();
    // Every transition line belongs to the root state machine; the promise child has no
    // `value` and produces no microstep, so no line should reference an unknown machine.
    for (const line of lines.filter(
      (l) => l.message === "state machine transition",
    )) {
      expect(line.meta["machine"]).toBe("test");
    }
  });

  test("includes the label and the projected scalar context", async () => {
    const lines = await run();
    const active = lines.find(
      (line) =>
        line.message === "state machine transition" &&
        line.meta["to"] === "active",
    );
    expect(active?.meta["label"]).toBe("test:1");
    expect(typeof active?.meta["n"]).toBe("number");
  });
});
