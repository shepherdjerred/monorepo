import { expect, it, vi } from "vitest";
import { createWorkerShutdown } from "./worker-shutdown.ts";

it("stops polling immediately and flushes only after final usage and Activity cleanup", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const run = (async () => {
    await completion;
    events.push("usage stored", "activity cleanup", "run settled");
  })();
  const shutdown = createWorkerShutdown({
    workers: [
      {
        getState: () => "RUNNING",
        shutdown: () => {
          events.push("stop polling");
        },
      },
    ],
    runs: [run],
    closeIngress: async () => {
      events.push("close ingress");
    },
    closeResources: async () => {
      events.push("close resources");
    },
    closeTracing: async () => {
      events.push("flush tracing");
    },
    closeCallGraph: async () => {
      events.push("flush callgraph");
    },
  });
  const pending = shutdown();
  expect(shutdown()).toBe(pending);
  expect(events).toEqual(["stop polling", "close ingress"]);
  await Promise.resolve();
  expect(events).not.toContain("flush tracing");
  finish();
  await pending;
  expect(events).toEqual([
    "stop polling",
    "close ingress",
    "usage stored",
    "activity cleanup",
    "run settled",
    "close resources",
    "flush tracing",
    "flush callgraph",
  ]);
  await shutdown();
  expect(events.filter((event) => event === "flush tracing")).toHaveLength(1);
});

it("retains final tracing even when ingress and resources fail or a run rejects", async () => {
  const trace = vi.fn(() => Promise.resolve()),
    callGraph = vi.fn(() => Promise.resolve());
  const failedRun = Promise.reject(new Error("Activity failed"));
  const shutdown = createWorkerShutdown({
    workers: [],
    runs: [failedRun],
    closeIngress: async () => {
      throw new Error("Ingress failed");
    },
    closeResources: async () => {
      throw new Error("Resources failed");
    },
    closeTracing: trace,
    closeCallGraph: callGraph,
  });
  await expect(shutdown()).rejects.toThrow("Worker shutdown failed");
  expect(trace).toHaveBeenCalledOnce();
  expect(callGraph).toHaveBeenCalledOnce();
});
