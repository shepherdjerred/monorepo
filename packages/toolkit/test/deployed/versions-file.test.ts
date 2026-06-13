import { test, expect, describe } from "bun:test";
import { parseVersionsFile } from "#lib/deployed/versions-file.ts";

const SAMPLE = `const versions = {
  "argo-cd": "9.5.14",
  "shepherdjerred/birmel":
    "2.0.0-3637@sha256:7b7dcd2c5d50dfdd44a961cfe07af01425189b7feb1f3761f04af769bfbbd554",
  "shepherdjerred/scout-for-lol/beta":
    "2.0.0-3637@sha256:d654e23855cab9719befb2952fb9c6c042f403c825f187c5af47d61561c3a06c",
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-2985@sha256:8b66f27b0daaff642a2ac838e838e8f8ccd64a21e2f9e09fb69730c1bbf8ff36",
  "redlib/redlib":
    "latest@sha256:e6647a94d553bf3f7c95c53fc6d9da5785e6c278d9002e99ea32abdb5e3c513a",
};
export default versions;`;

describe("parseVersionsFile", () => {
  test("extracts only first-party 2.0.0-<build> pins", () => {
    const pins = parseVersionsFile(SAMPLE);
    expect([...pins.keys()].toSorted()).toEqual([
      "shepherdjerred/birmel",
      "shepherdjerred/scout-for-lol/beta",
      "shepherdjerred/scout-for-lol/prod",
    ]);
  });

  test("parses build number and digest", () => {
    const pins = parseVersionsFile(SAMPLE);
    const beta = pins.get("shepherdjerred/scout-for-lol/beta");
    expect(beta?.build).toBe(3637);
    expect(beta?.tag).toBe("2.0.0-3637");
    expect(beta?.digest).toBe(
      "sha256:d654e23855cab9719befb2952fb9c6c042f403c825f187c5af47d61561c3a06c",
    );
  });

  test("ignores third-party (redlib, helm charts)", () => {
    const pins = parseVersionsFile(SAMPLE);
    expect(pins.has("redlib/redlib")).toBe(false);
    expect(pins.has("argo-cd")).toBe(false);
  });
});
