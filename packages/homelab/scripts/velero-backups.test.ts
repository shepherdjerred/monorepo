import { expect, test } from "bun:test";
import {
  parseVeleroArguments,
  readConfirmationLine,
  requiresClusterInventory,
} from "./migration-core.ts";

function openInput(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
  });
}

test("inspection is non-destructive by default", () => {
  expect(parseVeleroArguments(["inspect"])).toEqual({
    command: "inspect",
    apply: false,
    yes: false,
  });
});

test("destructive flags are explicit", () => {
  expect(parseVeleroArguments(["delete-all", "--apply", "--yes"])).toEqual({
    command: "delete-all",
    apply: true,
    yes: true,
  });
});

test("R2 deletion requires and validates its target", () => {
  expect(() => parseVeleroArguments(["delete-r2"])).toThrow("--target");
  expect(
    parseVeleroArguments(["delete-r2", "--target", "zfs", "--apply", "--yes"]),
  ).toEqual({
    command: "delete-r2",
    target: "zfs",
    apply: true,
    yes: true,
  });
  expect(() => parseVeleroArguments(["inspect", "--target", "all"])).toThrow(
    "only valid",
  );
  expect(() =>
    parseVeleroArguments(["delete-r2", "--target", "invalid"]),
  ).toThrow("requires backups");
});

test("R2-only deletion does not require cluster inventory", () => {
  expect(requiresClusterInventory("delete-r2")).toBe(false);
  expect(requiresClusterInventory("inspect")).toBe(true);
  expect(requiresClusterInventory("delete-all")).toBe(true);
});

test("rejects missing commands and unknown options", () => {
  expect(() => parseVeleroArguments([])).toThrow("Usage");
  expect(() => parseVeleroArguments(["inspect", "--unknown"])).toThrow(
    "Unknown option",
  );
});

test("interactive confirmation resolves on the first newline without EOF", async () => {
  await expect(
    readConfirmationLine(openInput("DELETE ", "ALL BACKUPS\r\nignored")),
  ).resolves.toBe("DELETE ALL BACKUPS");
});
