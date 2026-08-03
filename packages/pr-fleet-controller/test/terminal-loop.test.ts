import { expect, test } from "bun:test";
import {
  consumeTerminalLines,
  createSharedShutdown,
  settleRunResources,
} from "@shepherdjerred/pr-fleet-controller/src/terminal-loop.ts";

function noLines(): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ done: true, value: undefined }),
    }),
  };
}

async function* oneLine(): AsyncGenerator<string> {
  yield "/stop";
}

test("terminal EOF invokes controller shutdown", async () => {
  let stops = 0;
  await consumeTerminalLines(
    noLines(),
    () => Promise.reject(new Error("EOF must not dispatch a line")),
    () => {
      stops += 1;
      return Promise.resolve();
    },
  );
  expect(stops).toBe(1);
});

test("explicit stop uses the same idempotent end path", async () => {
  let lines = 0;
  let stops = 0;
  await consumeTerminalLines(
    oneLine(),
    () => {
      lines += 1;
      return Promise.resolve("stop");
    },
    () => {
      stops += 1;
      return Promise.resolve();
    },
  );
  expect(lines).toBe(1);
  expect(stops).toBe(1);
});

test("terminal handler failures reach the outcome-aware end path", async () => {
  const failure = new Error("tick failed");
  let received: unknown;
  await expect(
    consumeTerminalLines(
      oneLine(),
      () => Promise.reject(failure),
      (outcome) => {
        received = outcome;
        return Promise.resolve();
      },
    ),
  ).rejects.toBe(failure);
  expect(received).toEqual({ status: "failed", error: failure });
});

test("overlapping shutdown callers await one shared operation", async () => {
  let resolveShutdown: (() => void) | undefined;
  const shutdownSettled = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  let stops = 0;
  const stop = createSharedShutdown(() => {
    stops += 1;
    return shutdownSettled;
  });

  const first = stop();
  const second = stop();
  await Promise.resolve();
  expect(stops).toBe(1);
  expect(first).toBe(second);

  resolveShutdown?.();
  await Promise.all([first, second]);
});

test("resource settlement closes input first and preserves a captured snapshot", async () => {
  const calls: string[] = [];
  const expectedSnapshot = { open: 2 };
  const settlement = await settleRunResources({
    closeInput: () => {
      calls.push("close-input");
    },
    settleController: () => {
      calls.push("controller");
      return Promise.resolve(expectedSnapshot);
    },
    observeSnapshot: () => {
      calls.push("observer");
      throw new Error("observer unavailable");
    },
    settleRuntime: () => {
      calls.push("runtime");
      return Promise.reject(new Error("runtime unavailable"));
    },
  });

  expect(calls).toEqual(["close-input", "controller", "observer", "runtime"]);
  expect(settlement.snapshot).toBe(expectedSnapshot);
  expect(settlement.failure).toBeInstanceOf(AggregateError);
});

test("resource settlement continues cleanup when closing input fails", async () => {
  const calls: string[] = [];
  const settlement = await settleRunResources({
    closeInput: () => {
      calls.push("close-input");
      throw new Error("input close failed");
    },
    settleController: () => {
      calls.push("controller");
      return Promise.resolve(null);
    },
    observeSnapshot: () => {
      throw new Error("null snapshots must not be observed");
    },
    settleRuntime: () => {
      calls.push("runtime");
      return Promise.resolve();
    },
  });

  expect(calls).toEqual(["close-input", "controller", "runtime"]);
  expect(settlement.snapshot).toBeNull();
  expect(settlement.failure?.message).toBe("input close failed");
});
