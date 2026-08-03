import { expect, test } from "bun:test";
import {
  bakeFailureIsTransient,
  retryTransientBuildx,
  type BuildxCommandResult,
} from "./bake-retry.ts";

test.each([
  "unexpected EOF",
  "failed to receive status: error reading from server: EOF",
  'rpc error: code = Unavailable desc = closing transport, received prior goaway: debug data: "graceful_stop"',
  "panic: send on closed channel",
  "429 Too Many Requests",
  "toomanyrequests: retry your request later",
])("classifies %s as transient", (message) => {
  expect(bakeFailureIsTransient(message)).toBe(true);
});

test("does not retry deterministic build errors", () => {
  expect(bakeFailureIsTransient("failed to solve: missing COPY source")).toBe(
    false,
  );
});

test("only considers the bounded failure tail", () => {
  const log = ["unexpected EOF", ...Array.from({ length: 121 }, () => "frame")];
  expect(bakeFailureIsTransient(log.join("\n"))).toBe(false);
});

function commandResult(exitCode: number, stderr = ""): BuildxCommandResult {
  return { exitCode, stdout: "", stderr };
}

test("retries a transient failure and preserves bounded backoff", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const exitCode = await retryTransientBuildx(
    async () => {
      attempts += 1;
      return attempts === 1
        ? commandResult(1, "failed to receive status: unexpected EOF")
        : commandResult(0);
    },
    async (delayMs) => {
      delays.push(delayMs);
    },
  );

  expect(exitCode).toBe(0);
  expect(attempts).toBe(2);
  expect(delays).toEqual([15_000]);
});

test("returns deterministic failures without retrying", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const exitCode = await retryTransientBuildx(
    async () => {
      attempts += 1;
      return commandResult(1, "failed to solve: missing COPY source");
    },
    async (delayMs) => {
      delays.push(delayMs);
    },
  );

  expect(exitCode).toBe(1);
  expect(attempts).toBe(1);
  expect(delays).toEqual([]);
});

test("escalates repeated transport failures to Buildkite retry status", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const exitCode = await retryTransientBuildx(
    async () => {
      attempts += 1;
      return commandResult(1, "error reading from server: EOF; graceful_stop");
    },
    async (delayMs) => {
      delays.push(delayMs);
    },
  );

  expect(exitCode).toBe(34);
  expect(attempts).toBe(3);
  expect(delays).toEqual([15_000, 60_000]);
});
