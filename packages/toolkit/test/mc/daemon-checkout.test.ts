import { describe, expect, test } from "vitest";
import { daemonCheckoutMismatch } from "#lib/mc/client.ts";

describe("mc daemon checkout", () => {
  test("accepts the daemon that belongs to this checkout", () => {
    expect(daemonCheckoutMismatch("/repo", "/repo")).toBeNull();
    expect(daemonCheckoutMismatch("/repo/.", "/repo")).toBeNull();
  });

  test("names both paths and does not describe stopping the other daemon as the next step from here", () => {
    const message = daemonCheckoutMismatch("/other/worktree", "/this/checkout");
    expect(message).toContain("/other/worktree");
    expect(message).toContain("/this/checkout");
    expect(message).toContain("will not stop");
  });
});
