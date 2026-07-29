import { describe, expect, test } from "bun:test";
import {
  ciImagePromotionFiles,
  isCurrentSourceCandidate,
  newestPinState,
  parseCiImageCandidate,
  parseCiImagePinState,
  parsePlaywrightVersionFile,
  playwrightPackageVersion,
  playwrightVersionFromDockerfile,
  PLAYWRIGHT_PACKAGE_TARGETS,
  rewritePlaywrightPackage,
  serializedState,
  stateFromCandidate,
  verifyDigestFile,
} from "./update-ci-image-pin-core.ts";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const commit = (character: string): string => character.repeat(40);

const state = (
  buildNumber: number,
  character: string,
): ReturnType<typeof parseCiImagePinState> =>
  parseCiImagePinState({
    schema: "ci-image-pin-state/v1",
    buildNumber,
    sourceCommit: buildNumber === 0 ? "bootstrap" : commit(character),
    sourceFingerprint: buildNumber === 0 ? "bootstrap" : digest(character),
    digest: digest(character),
  });

describe("CI image candidate schema", () => {
  test("accepts only the strict v1 shape", () => {
    expect(
      parseCiImageCandidate({
        schema: "ci-image-candidate/v1",
        image: "ci-playwright",
        buildNumber: 42,
        sourceCommit: commit("a"),
        sourceFingerprint: digest("b"),
        digest: digest("c"),
      }),
    ).toEqual({
      schema: "ci-image-candidate/v1",
      image: "ci-playwright",
      buildNumber: 42,
      sourceCommit: commit("a"),
      sourceFingerprint: digest("b"),
      digest: digest("c"),
    });
  });

  test("rejects unknown fields and noncanonical identities", () => {
    expect(() =>
      parseCiImageCandidate({
        schema: "ci-image-candidate/v1",
        image: "ci-base",
        buildNumber: 1,
        sourceCommit: commit("a"),
        sourceFingerprint: digest("b"),
        digest: digest("c"),
        extra: true,
      }),
    ).toThrow("unknown or missing fields");
    expect(() =>
      parseCiImageCandidate({
        schema: "ci-image-candidate/v1",
        image: "ci-base",
        buildNumber: 1,
        sourceCommit: "main",
        sourceFingerprint: digest("b"),
        digest: digest("c"),
      }),
    ).toThrow("full lowercase commit SHA");
    expect(() =>
      parseCiImageCandidate({
        schema: "unsupported",
        image: "ci-base",
        buildNumber: 1,
        sourceCommit: commit("a"),
        sourceFingerprint: digest("b"),
        digest: digest("c"),
      }),
    ).toThrow("unsupported schema");
    expect(() =>
      parseCiImageCandidate({
        schema: "ci-image-candidate/v1",
        image: "ci-base",
        buildNumber: 0,
        sourceCommit: commit("a"),
        sourceFingerprint: digest("b"),
        digest: digest("c"),
      }),
    ).toThrow("safe positive integer");
    expect(() =>
      parseCiImageCandidate({
        schema: "ci-image-candidate/v1",
        image: "ci-base",
        buildNumber: 1,
        sourceCommit: commit("a"),
        sourceFingerprint: "main",
        digest: digest("c"),
      }),
    ).toThrow("sourceFingerprint");
  });

  test("converts a candidate to the persisted pin state", () => {
    const candidate = parseCiImageCandidate({
      schema: "ci-image-candidate/v1",
      image: "ci-base",
      buildNumber: 42,
      sourceCommit: commit("a"),
      sourceFingerprint: digest("b"),
      digest: digest("c"),
    });
    expect(stateFromCandidate(candidate)).toEqual({
      schema: "ci-image-pin-state/v1",
      buildNumber: 42,
      sourceCommit: commit("a"),
      sourceFingerprint: digest("b"),
      digest: digest("c"),
    });
  });
});

describe("CI image pin arbitration", () => {
  test("selects the highest build number", () => {
    expect(
      newestPinState([state(5, "a"), state(8, "b"), state(7, "c")]),
    ).toEqual(state(8, "b"));
  });

  test("accepts an idempotent equal-build state", () => {
    const current = state(8, "b");
    expect(newestPinState([current, state(8, "b")])).toEqual(current);
  });

  test("fails on equal-build divergent content", () => {
    expect(() => newestPinState([state(8, "a"), state(8, "b")])).toThrow(
      "Conflicting CI image pin states",
    );
  });

  test("rejects a higher-build candidate from a superseded image source", () => {
    const currentFingerprint = digest("b");
    const lateOldSourceBuild = state(99, "a");
    expect(
      isCurrentSourceCandidate(lateOldSourceBuild, currentFingerprint),
    ).toBe(false);
    expect(isCurrentSourceCandidate(state(42, "b"), currentFingerprint)).toBe(
      true,
    );
  });

  test("accepts a coherent bootstrap state only", () => {
    expect(state(0, "a").sourceCommit).toBe("bootstrap");
    expect(() =>
      parseCiImagePinState({
        schema: "ci-image-pin-state/v1",
        buildNumber: 0,
        sourceCommit: commit("a"),
        sourceFingerprint: digest("a"),
        digest: digest("a"),
      }),
    ).toThrow("bootstrap pin state");
  });

  test("rejects malformed pin state fields", () => {
    expect(() => parseCiImagePinState(null)).toThrow("must be an object");
    expect(() =>
      parseCiImagePinState({
        schema: "unsupported",
        buildNumber: 1,
        sourceCommit: commit("a"),
        sourceFingerprint: digest("a"),
        digest: digest("a"),
      }),
    ).toThrow("unsupported schema");
    expect(() =>
      parseCiImagePinState({
        schema: "ci-image-pin-state/v1",
        buildNumber: 1,
        sourceCommit: commit("a"),
        sourceFingerprint: digest("a"),
        digest: "latest",
      }),
    ).toThrow("canonical sha256 digest");
  });

  test("requires at least one state", () => {
    expect(() => newestPinState([])).toThrow(
      "At least one CI image pin state is required",
    );
  });

  test("validates and serializes the digest sidecar", () => {
    const current = state(8, "b");
    expect(() =>
      verifyDigestFile(`${current.digest}\n`, current),
    ).not.toThrow();
    expect(() => verifyDigestFile(`${digest("c")}\n`, current)).toThrow(
      "disagree",
    );
    expect(() => verifyDigestFile("latest\n", current)).toThrow(
      "canonical sha256 digest",
    );
    expect(serializedState(current)).toBe(
      `${JSON.stringify(current, null, 2)}\n`,
    );
  });
});

describe("Playwright candidate promotion", () => {
  const futureVersion = "1.63.0";
  const futureDockerfile = [
    "FROM oven/bun:1.3.14@sha256:" + "a".repeat(64) + " AS bun",
    "",
    "# renovate: datasource=docker depName=mcr.microsoft.com/playwright",
    `FROM mcr.microsoft.com/playwright:v${futureVersion}-noble@sha256:${"b".repeat(64)}`,
    "",
  ].join("\n");

  test("derives the package version from a future immutable image source", () => {
    expect(playwrightVersionFromDockerfile(futureDockerfile)).toBe(
      futureVersion,
    );
    expect(() =>
      playwrightVersionFromDockerfile(
        futureDockerfile.replace(
          `playwright:v${futureVersion}-noble@sha256:`,
          `playwright:v${futureVersion}-noble@latest:`,
        ),
      ),
    ).toThrow("exactly one immutable official Playwright noble image");
    expect(() =>
      playwrightVersionFromDockerfile(`${futureDockerfile}${futureDockerfile}`),
    ).toThrow("exactly one immutable official Playwright noble image");
  });

  test("rewrites every coupled package to the candidate image version", () => {
    for (const target of PLAYWRIGHT_PACKAGE_TARGETS) {
      const section = target.section;
      const source = `${JSON.stringify(
        {
          name: "fixture",
          [section]: { [target.dependency]: "1.62.0" },
        },
        null,
        2,
      )}\n`;
      const updated = rewritePlaywrightPackage(source, target, futureVersion);
      expect(playwrightPackageVersion(updated, target)).toBe(futureVersion);
      expect(updated).toContain(`"${target.dependency}": "${futureVersion}"`);
      expect(rewritePlaywrightPackage(updated, target, futureVersion)).toBe(
        updated,
      );
    }
  });

  test("rejects malformed active versions and missing package declarations", () => {
    expect(parsePlaywrightVersionFile(`${futureVersion}\n`)).toBe(
      futureVersion,
    );
    expect(() => parsePlaywrightVersionFile(`v${futureVersion}\n`)).toThrow(
      "canonical semver line",
    );
    expect(() => parsePlaywrightVersionFile(futureVersion)).toThrow(
      "canonical semver line",
    );
    const target = PLAYWRIGHT_PACKAGE_TARGETS[0];
    expect(target).toBeDefined();
    if (target === undefined) {
      throw new Error("Playwright package target fixture is missing");
    }
    expect(() =>
      rewritePlaywrightPackage(
        '{\n  "dependencies": {}\n}\n',
        target,
        futureVersion,
      ),
    ).toThrow("missing dependencies.playwright");
  });

  test("stages the complete atomic package and image promotion", () => {
    expect(ciImagePromotionFiles("ci-playwright")).toEqual([
      ".buildkite/ci-playwright/DIGEST",
      ".buildkite/ci-playwright/STATE.json",
      ".buildkite/ci-playwright/PACKAGE_VERSION",
      "packages/birmel/package.json",
      "packages/monarch/package.json",
      "packages/sjer.red/package.json",
      "bun.lock",
    ]);
    expect(ciImagePromotionFiles("ci-base")).toEqual([
      "packages/homelab/src/cdk8s/src/resources/argo-applications/ci-base.DIGEST",
      ".buildkite/ci-image/STATE.json",
    ]);
  });
});
