import { describe, expect, test } from "vitest";
import { trackerImageReference } from "./image.ts";

describe("tracker image release gate", () => {
  test("does not activate on the explicit unpublished image marker", () => {
    expect(
      trackerImageReference(`0.0.0@sha256:${"0".repeat(64)}`),
    ).toBeUndefined();
  });

  test("accepts only a real immutable catalog digest", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(trackerImageReference(`2.0.0-9341@${digest}`)).toBe(
      `ghcr.io/shepherdjerred/tracker@${digest}`,
    );
    expect(trackerImageReference("latest")).toBeUndefined();
  });
});
