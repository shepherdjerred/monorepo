import { describe, expect, test } from "vitest";
import { requireGateImage } from "#src/gate-image.ts";

describe("deployed gate image migration", () => {
  test.each(["ghcr.io", "docker.io"])(
    "accepts the exact %s policy repository with a digest",
    (registry) => {
      const reference = `${registry}/shepherdjerred/woodpecker-config-extension:2.0.0-1@sha256:${"a".repeat(64)}`;
      expect(requireGateImage(reference)).toBe(reference);
    },
  );

  test.each([
    "docker.io/shepherdjerred/woodpecker-config-extension:latest",
    `docker.io/other/woodpecker-config-extension@sha256:${"a".repeat(64)}`,
    `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
    `docker.io.evil.example/shepherdjerred/woodpecker-config-extension@sha256:${"a".repeat(64)}`,
    `docker.io/shepherdjerred/woodpecker-config-extension@sha256:${"a".repeat(63)}`,
  ])("rejects an untrusted or mutable policy reference: %s", (reference) => {
    expect(() => requireGateImage(reference)).toThrow(
      "must pin the deployed policy image by digest",
    );
  });
});
