import { expect, test } from "bun:test";
import {
  createLatestPreparationTrace,
  assertLatestPreparationEvent,
} from "./latest-preparation-trace.mjs";
import { LatestParticleWorkerClient } from "./latest-particle-worker-client.mjs";

test("preparation callbacks remain opt-in and expose only bounded scalar counts", () => {
  createLatestPreparationTrace()("decode", "begin", { records: 261498 });
  const events = [],
    trace = createLatestPreparationTrace(
      (event) => events.push(event),
      "test-worker",
    );
  trace("decode", "begin", { records: 261498 });
  trace("decode", "end", { bytes: 135433883 });
  expect(events.map((event) => event.phase)).toEqual(["begin", "end"]);
  expect(events[1].elapsedMs).toBeGreaterThanOrEqual(events[0].elapsedMs);
  expect(events[0].source).toBe("test-worker");
  expect(() => trace("decode", "end", { invalid: Number.NaN })).toThrow(
    "Bounded preparation",
  );
  expect(() =>
    assertLatestPreparationEvent({ ...events[0], phase: "failed" }),
  ).toThrow("Bounded preparation");
});

test("owned worker diagnostic messages do not consume the pending result", async () => {
  const originalWorker = globalThis.Worker;
  class ControlledWorker {
    postMessage(message) {
      this.sent = message;
    }
    terminate() {
      this.terminated = true;
    }
  }
  globalThis.Worker = ControlledWorker;
  try {
    const events = [],
      client = new LatestParticleWorkerClient({
        onPreparation: (event) => events.push(event),
      });
    const pending = client.request("prepare", {}),
      request = client.worker.sent;
    expect(request.preparationDiagnostics).toBe(true);
    let event;
    createLatestPreparationTrace((record) => {
      event = record;
    }, "controlled")("prepare", "begin", { records: 1 });
    client.worker.onmessage({
      data: { version: 1, id: request.id, type: "preparation", event },
    });
    expect(events).toHaveLength(1);
    expect(client.pending.size).toBe(1);
    client.worker.onmessage({
      data: { version: 1, id: request.id, ok: true, result: "complete" },
    });
    expect(await pending).toBe("complete");
    expect(client.pending.size).toBe(0);
    client.close();
  } finally {
    globalThis.Worker = originalWorker;
  }
});
