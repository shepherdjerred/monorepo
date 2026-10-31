import { describe, expect, test } from "vitest";
import { awaitDaemonReady, daemonLogPath } from "#lib/mc/spawn.ts";

describe("awaitDaemonReady", () => {
  test("includes stderr in error when daemon exits early with output", async () => {
    await expect(
      awaitDaemonReady(
        () => 1,
        () => "Cannot find module 'foo'\n",
      ),
    ).rejects.toThrow(
      "mc daemon exited early with code 1: Cannot find module 'foo'",
    );
  });

  test("falls back to log path when daemon exits early with no stderr", async () => {
    await expect(
      awaitDaemonReady(
        () => 2,
        () => "   ",
      ),
    ).rejects.toThrow(
      `mc daemon exited early with code 2: Logs: ${daemonLogPath()}`,
    );
  });
});
