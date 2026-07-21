import { describe, expect, test } from "bun:test";

import { compareBuildxMetadata } from "./compare-buildx-metadata.ts";

function metadata(mode: "docker-container" | "containerd-default") {
  return {
    mode,
    builder: mode === "docker-container" ? "ci" : "default",
    commit: "a".repeat(40),
    benchmarkId: "ci-io-20260720",
    imageVersion: "ci-io-20260720",
    readCache: false,
    buildxVersion: "github.com/docker/buildx v0.25.0",
    builderDetails: `Driver: ${mode === "docker-container" ? "docker-container" : "docker"}`,
    dockerVersion: {
      Client: { Version: "28.3.0" },
      Server: { Version: "28.3.0" },
    },
    dockerInfo: {
      Driver: mode === "docker-container" ? "overlay2" : "overlayfs",
    },
  };
}

describe("compareBuildxMetadata", () => {
  test("accepts controlled groups with the expected modes", () => {
    expect(() =>
      compareBuildxMetadata(
        [metadata("docker-container"), metadata("docker-container")],
        [metadata("containerd-default"), metadata("containerd-default")],
      ),
    ).not.toThrow();
  });

  test("rejects the wrong baseline mode or mutable cache input", () => {
    expect(() =>
      compareBuildxMetadata(
        [metadata("containerd-default")],
        [metadata("containerd-default")],
      ),
    ).toThrow("unexpected Buildx mode");
    expect(() =>
      compareBuildxMetadata(
        [{ ...metadata("docker-container"), readCache: true }],
        [metadata("containerd-default")],
      ),
    ).toThrow();
  });

  test("rejects cross-fixture or cross-build environment drift", () => {
    expect(() =>
      compareBuildxMetadata(
        [
          metadata("docker-container"),
          { ...metadata("docker-container"), benchmarkId: "different" },
        ],
        [metadata("containerd-default"), metadata("containerd-default")],
      ),
    ).toThrow("do not share one controlled environment");
    expect(() =>
      compareBuildxMetadata(
        [metadata("docker-container")],
        [{ ...metadata("containerd-default"), commit: "b".repeat(40) }],
      ),
    ).toThrow("do not share one controlled environment");
  });
});
