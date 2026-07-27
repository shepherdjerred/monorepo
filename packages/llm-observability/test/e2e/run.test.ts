import { expect, test } from "bun:test";
import { waitForTempo } from "./run-core.ts";

test("stops checking once Tempo is ready", async () => {
  let attempts = 0;
  await waitForTempo(async () => {
    attempts += 1;
    return true;
  }, 2);
  expect(attempts).toBe(1);
});

test("fails after the configured attempts", async () => {
  expect(waitForTempo(async () => false, 1, 0)).rejects.toThrow(
    "Tempo did not become ready",
  );
});
