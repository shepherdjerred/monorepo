import { describe, expect, test } from "vitest";
import {
  deriveCheckpointPath,
  resolveCheckpointFile,
  resolveDateRange,
} from "./config.ts";

describe("deriveCheckpointPath", () => {
  test("returns undefined without an output path", () => {
    const outputPath: string | undefined = undefined;
    expect(deriveCheckpointPath(outputPath)).toBeUndefined();
  });

  test("replaces a json suffix with checkpoint json", () => {
    expect(deriveCheckpointPath("/tmp/monarch-output.json")).toBe(
      "/tmp/monarch-output.checkpoint.json",
    );
  });

  test("appends checkpoint suffix for non-json output paths", () => {
    expect(deriveCheckpointPath("/tmp/monarch-output")).toBe(
      "/tmp/monarch-output.checkpoint.json",
    );
  });
});

describe("resolveCheckpointFile", () => {
  test("prefers an explicit checkpoint path", () => {
    expect(
      resolveCheckpointFile("/tmp/custom.checkpoint.json", "/tmp/output.json"),
    ).toBe("/tmp/custom.checkpoint.json");
  });

  test("treats an empty checkpoint path as unset", () => {
    expect(resolveCheckpointFile("", "/tmp/output.json")).toBe(
      "/tmp/output.checkpoint.json",
    );
  });
});

describe("resolveDateRange", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  test("defaults to the trailing year, preserving prior behavior", () => {
    const range = resolveDateRange(undefined, undefined, now);
    expect(range.until).toBe("2026-09-17");
    expect(range.since).toBe("2025-09-17");
  });

  test("accepts explicit bounds", () => {
    const range = resolveDateRange("2021-01-01", "2026-01-31", now);
    expect(range).toEqual({ since: "2021-01-01", until: "2026-01-31" });
  });

  test("rejects a malformed date", () => {
    expect(() => resolveDateRange("01/02/2021", undefined, now)).toThrow();
  });

  test("rejects an inverted range", () => {
    expect(() => resolveDateRange("2026-05-01", "2026-01-01", now)).toThrow(
      /after/,
    );
  });
});
