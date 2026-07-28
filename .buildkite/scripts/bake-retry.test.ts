import { expect, test } from "bun:test";
import { bakeFailureIsTransient } from "./bake-retry.ts";

test.each([
  "unexpected EOF",
  "failed to receive status: error reading from server: EOF",
  "panic: send on closed channel",
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
