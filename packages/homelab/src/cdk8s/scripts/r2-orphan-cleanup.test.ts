import { describe, expect, test } from "bun:test";
import { parseR2OrphanArguments } from "./r2-orphan-cleanup.ts";

describe("R2 orphan cleanup arguments", () => {
  test("keeps inspection non-destructive", () => {
    expect(
      parseR2OrphanArguments(["inspect", "--manifest", "/tmp/r2-orphans.json"]),
    ).toEqual({
      command: "inspect",
      manifestPath: "/tmp/r2-orphans.json",
      apply: false,
      yes: false,
    });
  });

  test("requires a separate apply flag for destructive execution", () => {
    expect(
      parseR2OrphanArguments(["apply", "--manifest", "/tmp/r2-orphans.json"])
        .apply,
    ).toBe(false);
    expect(
      parseR2OrphanArguments([
        "apply",
        "--manifest",
        "/tmp/r2-orphans.json",
        "--apply",
        "--yes",
      ]),
    ).toEqual({
      command: "apply",
      manifestPath: "/tmp/r2-orphans.json",
      apply: true,
      yes: true,
    });
  });

  test("rejects destructive flags during inspection", () => {
    expect(() =>
      parseR2OrphanArguments([
        "inspect",
        "--manifest",
        "/tmp/r2-orphans.json",
        "--apply",
      ]),
    ).toThrow("does not accept destructive flags");
  });
});
