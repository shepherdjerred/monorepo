import { describe, expect, test } from "bun:test";

import { compareImageManifests } from "./compare-image-manifests.ts";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function manifest() {
  return {
    selectedBakeTargets: ["tasknotes-server"],
    images: [
      {
        target: "tasknotes-server",
        image: "tasknotes-server:dev",
        imageId: DIGEST_A,
        rootfsLayers: [DIGEST_B],
        os: "linux",
        architecture: "amd64",
        smokePassed: true,
      },
    ],
  };
}

describe("compareImageManifests", () => {
  test("accepts identical deterministic manifests", () => {
    expect(() => compareImageManifests(manifest(), manifest())).not.toThrow();
  });

  test("rejects a config or filesystem difference", () => {
    const candidate = manifest();
    const firstImage = candidate.images[0];
    if (firstImage === undefined) {
      throw new Error("candidate image fixture is missing");
    }
    firstImage.imageId = DIGEST_B;
    expect(() => compareImageManifests(manifest(), candidate)).toThrow(
      "image manifest differs",
    );
  });

  test("rejects hidden fields and nondeterministic target order", () => {
    expect(() =>
      compareImageManifests(manifest(), {
        selectedBakeTargets: ["z", "a"],
        images: manifest().images,
      }),
    ).toThrow("selectedBakeTargets must be sorted and unique");
    expect(() =>
      compareImageManifests(manifest(), {
        ...manifest(),
        generatedAt: "2026-07-20T00:00:00Z",
      }),
    ).toThrow();
  });
});
