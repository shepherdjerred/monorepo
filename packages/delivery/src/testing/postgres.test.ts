import { describe, expect, test } from "vitest";
import { isOrphanedTestCluster } from "./postgres.ts";

describe("disposable postgres ownership", () => {
  test("a cluster owned by this process is not an orphan", () => {
    expect(isOrphanedTestCluster(10, 10, () => false)).toBe(false);
  });

  test("a cluster owned by another live process is not an orphan", () => {
    expect(isOrphanedTestCluster(11, 10, () => true)).toBe(false);
  });

  test("a dead owner or a missing pid is an orphan", () => {
    expect(isOrphanedTestCluster(11, 10, () => false)).toBe(true);
    expect(isOrphanedTestCluster(null, 10, () => true)).toBe(true);
  });
});
