import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ScoutTemporalQueueClass } from "#src/configuration/runtime-role.ts";
import { createScoutTemporalActivityGroups } from "#src/temporal/activities.ts";
import { ScoutTemporalSupervisor } from "#src/temporal/supervisor.ts";

type FakeWorker = {
  getState: () => string;
  run: () => Promise<void>;
  shutdown: () => void;
};
type FakeRuntime = {
  workers: FakeWorker[];
  client: Record<string, never>;
};
const mocks = vi.hoisted(() => ({
  create:
    vi.fn<
      (
        options: unknown,
        queues: ReadonlySet<ScoutTemporalQueueClass>,
      ) => Promise<FakeRuntime>
    >(),
  close: vi.fn<(runtime: FakeRuntime) => Promise<void>>(),
  stop: vi.fn<
    (runtime: FakeRuntime, runs: readonly Promise<void>[]) => Promise<void>
  >(),
}));
vi.mock("#src/temporal/connected-runtime.ts", () => ({
  createConnectedRuntime: mocks.create,
  closeConnectedRuntime: mocks.close,
  stopConnectedRuntime: mocks.stop,
  reconnectDelayMs: () => 0,
}));

function runtime(queues: ReadonlySet<ScoutTemporalQueueClass>): FakeRuntime {
  const stopped = Promise.withResolvers<undefined>();
  let state = "RUNNING";
  return {
    client: {},
    workers: queues.has("gateway")
      ? [
          {
            getState: () => state,
            run: () => stopped.promise,
            shutdown: () => {
              state = "STOPPED";
              stopped.resolve(undefined);
            },
          },
        ]
      : [],
  };
}

function supervisor() {
  return new ScoutTemporalSupervisor({
    address: "127.0.0.1:7233",
    namespace: "beta",
    stage: "beta",
    activities: createScoutTemporalActivityGroups(),
    callGraphTracing: false,
    metrics: undefined,
    workers: [],
    deferredWorkers: ["gateway"],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockImplementation(async (_options, queues) => runtime(queues));
  mocks.close.mockResolvedValue();
  mocks.stop.mockImplementation(async (active, runs) => {
    for (const worker of active.workers) worker.shutdown();
    await Promise.all(runs);
  });
});

describe("gateway deferred worker startup", () => {
  test("widens an already connected client-only runtime once Discord is ready", async () => {
    const subject = supervisor();
    try {
      await vi.waitFor(() => expect(subject.readClient()).toBeDefined());
      expect(mocks.create.mock.calls[0]?.[1].size).toBe(0);
      subject.enableDeferredWorkers();
      await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
      expect(mocks.create.mock.calls[1]?.[1]).toEqual(new Set(["gateway"]));
      expect(mocks.stop).toHaveBeenCalledTimes(1);
      subject.enableDeferredWorkers();
      await Bun.sleep(10);
      expect(mocks.create).toHaveBeenCalledTimes(2);
    } finally {
      await subject.shutdown();
    }
  });

  test("discards a narrow connection that completes after Discord becomes ready", async () => {
    const connecting = Promise.withResolvers<FakeRuntime>();
    mocks.create.mockImplementationOnce(async () => connecting.promise);
    const subject = supervisor();
    try {
      subject.enableDeferredWorkers();
      connecting.resolve(runtime(new Set<ScoutTemporalQueueClass>()));
      await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
      expect(mocks.close).toHaveBeenCalledTimes(1);
      expect(mocks.create.mock.calls[1]?.[1]).toEqual(new Set(["gateway"]));
      await Bun.sleep(10);
      expect(mocks.create).toHaveBeenCalledTimes(2);
    } finally {
      await subject.shutdown();
    }
  });
});
