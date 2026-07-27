import { describe, expect, test } from "bun:test";

import { FORBIDDEN_DOCKER_IN_DOCKER_PATTERNS } from "./validate-pipeline-lib.ts";

function hasForbiddenDockerInDockerPath(source: string): boolean {
  return FORBIDDEN_DOCKER_IN_DOCKER_PATTERNS.some((pattern) =>
    pattern.test(source),
  );
}

describe("Docker-in-Docker pipeline guard", () => {
  test("rejects canonical and versioned DinD image tags", () => {
    expect(hasForbiddenDockerInDockerPath('image: "docker:dind"')).toBe(true);
    expect(hasForbiddenDockerInDockerPath('image: "docker:29-dind"')).toBe(
      true,
    );
    expect(
      hasForbiddenDockerInDockerPath('image: "docker:29.1-dind-rootless"'),
    ).toBe(true);
  });

  test("allows a regular Docker CLI image", () => {
    expect(hasForbiddenDockerInDockerPath('image: "docker:29"')).toBe(false);
  });
});
