import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { awaitNativeCandidate, candidateReady } from "./native-readiness.ts";

it("requires an actual JSON boolean from the candidate completion fixture", () => {
  expect(candidateReady("false")).toBe(false);
  expect(candidateReady("true")).toBe(true);
  for (const reply of [
    '"false"',
    '"true"',
    "1",
    "null",
    "{}",
    "[]",
    "Ready: true, phase: Lobby",
  ]) {
    expect(() => candidateReady(reply)).toThrow();
  }
});

it("waits past general Lobby readiness until the exact candidate completes, retaining both replies", async () => {
  const commands: string[] = [];
  let candidates = 0;
  const result = await awaitNativeCandidate(
    {
      command(command: string) {
        commands.push(command);
        if (command === "rwf admin status")
          return Promise.resolve("Ready: true, phase: Lobby");
        candidates += 1;
        return Promise.resolve(candidates === 2 ? "true" : "false");
      },
    },
    "apex-expanse",
  );
  try {
    expect(commands).toEqual([
      "rwf admin status",
      "storm-fixture-map-lifecycle candidate-ready apex-expanse",
      "rwf admin status",
      "storm-fixture-map-lifecycle candidate-ready apex-expanse",
    ]);
    const retained = await readFile(result.preparation.replies, "utf8");
    const replies = retained
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(replies).toEqual(
      commands.map((command, i) => ({
        requestedAt: expect.any(Number),
        receivedAt: expect.any(Number),
        command,
        reply:
          i % 2 === 0
            ? "Ready: true, phase: Lobby"
            : i === 1
              ? "false"
              : "true",
      })),
    );
    expect(result.preparation.readyAt).toBeGreaterThanOrEqual(
      result.preparation.startedAt,
    );
    expect(result.preparation.method).toBe(commands[1]);
  } finally {
    await rm(path.dirname(result.preparation.replies), { recursive: true });
  }
});
