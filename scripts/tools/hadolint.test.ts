import { describe, expect, test } from "vitest";

import { isHadolintCandidate } from "./hadolint.ts";

describe("isHadolintCandidate", () => {
  test("includes Dockerfiles but excludes their Docker ignore files", () => {
    expect(isHadolintCandidate("packages/the-storm/server/Dockerfile")).toBe(
      true,
    );
    expect(
      isHadolintCandidate("packages/the-storm/server/Dockerfile.dev"),
    ).toBe(true);
    expect(
      isHadolintCandidate("packages/the-storm/server/dev.Dockerfile"),
    ).toBe(true);
    expect(
      isHadolintCandidate("packages/the-storm/server/Dockerfile.dockerignore"),
    ).toBe(false);
  });

  test("ignores sandbox Dockerfiles", () => {
    expect(isHadolintCandidate("sandbox/Dockerfile")).toBe(false);
  });
});
