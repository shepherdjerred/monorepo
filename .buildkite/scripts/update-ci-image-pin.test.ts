import { describe, expect, test } from "bun:test";
import {
  ciImagePromotionFiles,
  classifyCiImageRuntimePromotion,
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

describe("CI image runtime promotion", () => {
  const repository = "ghcr.io/shepherdjerred/ci-base";
  const pinnedDigest = digest("a");
  const candidateDigest = digest("b");

  test("skips a distinct manifest with identical runtime content", async () => {
    const inspected: string[] = [];
    const outcome = await classifyCiImageRuntimePromotion(
      { repository, pinnedDigest, candidateDigest },
      async (image) => {
        inspected.push(image);
        return "same-runtime-content";
      },
    );

    expect(outcome).toBe("content-unchanged");
    expect(inspected).toEqual([
      `${repository}@${candidateDigest}`,
      `${repository}@${pinnedDigest}`,
    ]);
  });

  test("promotes when the runtime identity changes", async () => {
    const outcome = await classifyCiImageRuntimePromotion(
      { repository, pinnedDigest, candidateDigest },
      async (image) =>
        image === `${repository}@${candidateDigest}`
          ? "candidate-runtime-content"
          : "pinned-runtime-content",
    );

    expect(outcome).toBe("bumped");
  });

  test("promotes a verified candidate when the existing pin is unavailable", async () => {
    const outcome = await classifyCiImageRuntimePromotion(
      { repository, pinnedDigest, candidateDigest },
      async (image) => {
        if (image === `${repository}@${candidateDigest}`) {
          return "candidate-runtime-content";
        }
        return;
      },
    );

    expect(outcome).toBe("pin-unresolvable-bumped");
  });

  test("fails when the candidate cannot be fingerprinted", async () => {
    const unavailableFingerprints = new Map<string, string>();
    await expect(
      classifyCiImageRuntimePromotion(
        { repository, pinnedDigest, candidateDigest },
        async () => unavailableFingerprints.get("candidate"),
      ),
    ).rejects.toThrow(
      `Could not fingerprint CI image candidate ${repository}@${candidateDigest}`,
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

  test("coordinates its nested lockfile install with cache collection", async () => {
    const source = await Bun.file(
      new URL("update-ci-image-pin.ts", import.meta.url),
    ).text();

    expect(source).toContain(
      'await run([BUN_INSTALL_WRAPPER, "--lockfile-only"]',
    );
    expect(source).not.toContain('await run(["bun", "install"');
  });

  test("funnels every no-promotion exit through finalizeSkippedPromotion", async () => {
    const source = await Bun.file(
      new URL("update-ci-image-pin.ts", import.meta.url),
    ).text();

    // The single skip path retires any stale PR and re-verifies the main pin.
    const helperStart = source.indexOf(
      "async function finalizeSkippedPromotion(",
    );
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = source.slice(
      helperStart,
      source.indexOf("\n}\n", helperStart),
    );
    expect(helperBody).toContain("skipping pin promotion");
    expect(helperBody).toContain("await retireStalePromotion(");
    expect(helperBody).toContain("await assertMainPinUnchanged(");

    // All three no-promotion exits — digest-equal, older-than-pin, and
    // content-unchanged — route through the one funnel with a distinct reason.
    const calls = source.match(/await finalizeSkippedPromotion\(/g) ?? [];
    expect(calls).toHaveLength(3);
    expect(source).toContain(
      'reason: "candidate has no runtime digest change"',
    );
    expect(source).toContain(
      'reason: "candidate is older than the committed pin"',
    );
    expect(source).toContain(
      'reason: "candidate runtime content is unchanged"',
    );

    // promote() never invokes retirement or the recheck inline — only via the
    // funnel — so no exit path can bypass either guarantee.
    const promoteBody = source.slice(source.indexOf("async function promote("));
    expect(promoteBody).not.toContain("await retireStalePromotion(");
    expect(promoteBody).not.toContain("await assertMainPinUnchanged(");
  });

  test("dry-run reports the decision without cloning or retiring", async () => {
    const source = await Bun.file(
      new URL("update-ci-image-pin.ts", import.meta.url),
    ).text();

    const dryRunIndex = source.indexOf("if (dryRun) {");
    const cloneIndex = source.indexOf('"git", "clone"');
    expect(dryRunIndex).toBeGreaterThan(-1);
    expect(cloneIndex).toBeGreaterThan(dryRunIndex);
    const dryRunBlock = source.slice(dryRunIndex, cloneIndex);
    expect(dryRunBlock).not.toContain("finalizeSkippedPromotion");
    expect(dryRunBlock).not.toContain("retireStalePromotion");
    expect(dryRunBlock).toContain("DRYRUN: would promote");
  });

  test("the retirement helper closes the stale PR and deletes its branch", async () => {
    const github = await Bun.file(
      new URL("update-ci-image-pin-github.ts", import.meta.url),
    ).text();
    const helperStart = github.indexOf(
      "export async function retireStalePromotion(",
    );
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = github.slice(
      helperStart,
      github.indexOf("\n}\n", helperStart),
    );
    expect(helperBody).toContain('"close"');
    expect(helperBody).toContain('"--delete"');
  });

  test("the main-pin guard re-fetches main and fails transiently on a move", async () => {
    const source = await Bun.file(
      new URL("update-ci-image-pin.ts", import.meta.url),
    ).text();
    const helperStart = source.indexOf(
      "async function assertMainPinUnchanged(",
    );
    expect(helperStart).toBeGreaterThan(-1);
    const helperBody = source.slice(
      helperStart,
      source.indexOf("\n}\n", helperStart),
    );
    expect(helperBody).toContain('"fetch", "origin", "main"');
    expect(helperBody).toContain("throw new TransientError(");
  });
});
