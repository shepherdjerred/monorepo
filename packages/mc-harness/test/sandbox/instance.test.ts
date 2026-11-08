import path from "node:path";
import { describe, expect, it } from "vitest";
import { instanceDirectory, instanceOwner } from "#protocol/instance.ts";

describe("isolated harness instances", () => {
  it("keeps the default directory for an absent or empty bootstrap setting", () => {
    expect(instanceDirectory("/private/mc", undefined)).toBe("/private/mc");
    expect(instanceDirectory("/private/mc", "")).toBe("/private/mc");
  });

  it("gives concurrent tasks disjoint state without changing the shared root", () => {
    const first = instanceDirectory("/private/mc", "skylands");
    const second = instanceDirectory("/private/mc", "other-task");
    expect(first).toBe(path.join("/private/mc", "instances", "skylands"));
    expect(second).not.toBe(first);
    expect(instanceDirectory("/private/mc", undefined)).toBe("/private/mc");
    expect(instanceOwner("user@host", undefined)).toBe("user@host");
    expect(instanceOwner("user@host", "skylands")).toBe("user@host:skylands");
    expect(instanceOwner("user@host", "skylands")).not.toBe(
      instanceOwner("user@host", "other-task"),
    );
  });

  it.each([
    "../other",
    "/tmp/other",
    "a/b",
    String.raw`a\b`,
    " a",
    "Uppercase",
    "a".repeat(33),
    null,
    3,
  ])("rejects invalid instance names: %s", (name) => {
    expect(() => instanceDirectory("/private/mc", name)).toThrow();
  });
});
