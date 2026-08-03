import { expect, test } from "bun:test";
import { consumeTerminalLines } from "@shepherdjerred/pr-fleet-controller/src/terminal-loop.ts";

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
