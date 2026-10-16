import { AsyncLocalStorage } from "node:async_hooks";
import { Client, Connection } from "@temporalio/client";
import { expect, test, vi } from "vitest";
import {
  inspectScheduleHealth,
  scheduleHealthReader,
} from "./temporal-schedules-client.ts";

test("direct audit reads propagate their budget to RPCs and cancel in-flight work", async () => {
  const connection = Connection.lazy({ address: "127.0.0.1:1" });
  const signals = new AsyncLocalStorage<AbortSignal>();
  const deadlines = new AsyncLocalStorage<number>();
  const abortScope = vi
    .spyOn(connection, "withAbortSignal")
    .mockImplementation((signal, operation) => signals.run(signal, operation));
  const deadlineScope = vi
    .spyOn(connection, "withDeadline")
    .mockImplementation((deadline, operation) =>
      deadlines.run(
        deadline instanceof Date ? deadline.getTime() : deadline,
        operation,
      ),
    );
  const reader = scheduleHealthReader(
    new Client({ connection, namespace: "dev" }),
  );
  const observedSignals = new Set<AbortSignal>();
  const observedDeadlines = new Set<number>();
  const rpcScope = () => {
    const signal = signals.getStore();
    const deadline = deadlines.getStore();
    if (signal === undefined || deadline === undefined) {
      throw new Error("RPC has no cancellation signal or deadline");
    }
    observedSignals.add(signal);
    observedDeadlines.add(deadline);
    return signal;
  };
  reader.list = async function* () {
    rpcScope();
    for (let index = 0; index < 9; index += 1) {
      yield { scheduleId: `ops-${String(index)}` };
    }
  };
  reader.listCompletedActions = async () => {
    rpcScope();
    return [];
  };
  let started = 0;
  let cancelled = 0;
  let active = 0;
  let maximumActive = 0;
  reader.describeSchedule = (id) => {
    const signal = rpcScope();
    started += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    return new Promise<never>((_resolve, reject) => {
      if (id === "ops-0") {
        setTimeout(() => {
          active -= 1;
          reject(new Error("schedule failure"));
        }, 0);
      } else {
        signal.addEventListener(
          "abort",
          () => {
            cancelled += 1;
            active -= 1;
            reject(new Error("RPC cancelled"));
          },
          { once: true },
        );
      }
    });
  };
  try {
    const before = Date.now();
    await expect(
      inspectScheduleHealth(reader, "dev", new Date()),
    ).rejects.toThrow("schedule failure");
    expect(maximumActive).toBe(8);
    expect(cancelled).toBe(started - 1);
    expect(active).toBe(0);
    expect(observedSignals.size).toBe(1);
    expect([...observedSignals][0]?.aborted).toBe(true);
    expect(observedDeadlines.size).toBe(1);
    const deadline = [...observedDeadlines][0];
    expect(deadline).toBeGreaterThanOrEqual(before + 44_000);
    expect(deadline).toBeLessThanOrEqual(before + 46_000);
  } finally {
    abortScope.mockRestore();
    deadlineScope.mockRestore();
    await connection.close();
  }
});
