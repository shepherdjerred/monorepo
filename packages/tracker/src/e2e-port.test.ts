import { describe, expect, test } from "vitest";
import { e2ePort, sameCheckout, selectE2ePort } from "./e2e-port.ts";

describe("Tracker e2e port", () => {
  test("hashes a checkout into the local port range", () => {
    const port = e2ePort("/tmp/worktree-a");
    expect(port).toBeGreaterThanOrEqual(20_000);
    expect(port).toBeLessThan(50_000);
    expect(e2ePort("/tmp/worktree-a")).toBe(port);
    expect(e2ePort("/tmp/worktree-b")).not.toBe(port);
  });

  test("treats the package directory as the same checkout", () => {
    expect(sameCheckout("/repo", "/repo")).toBe(true);
    expect(sameCheckout("/repo", "/repo/packages/tracker")).toBe(true);
    expect(sameCheckout("/repo", "/repo-other/packages/tracker")).toBe(false);
  });

  test("keeps a foreign listener and uses the next free port", () => {
    const checkout = "/tmp/this-checkout";
    const first = e2ePort(checkout);
    const occupied = (port: number) =>
      port === first ? "/tmp/other-checkout/packages/tracker" : null;
    expect(selectE2ePort(checkout, false, occupied)).toBe(first + 1);
  });

  test("reuses a listener that belongs to this checkout", () => {
    const checkout = "/tmp/this-checkout";
    const first = e2ePort(checkout);
    expect(
      selectE2ePort(checkout, false, (port) =>
        port === first ? `${checkout}/packages/tracker` : "/tmp/other",
      ),
    ).toBe(first);
  });

  test("CI uses the hashed port even when another checkout owns it", () => {
    const checkout = "/tmp/this-checkout";
    expect(selectE2ePort(checkout, true, () => "/tmp/other")).toBe(
      e2ePort(checkout),
    );
  });
});
