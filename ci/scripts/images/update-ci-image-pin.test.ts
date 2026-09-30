import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { asRecord, toStringRecord } from "../../../scripts/lib/json.ts";
import {
  checkedOutSourceCommand,
  ciImagePromotionFiles,
  classifyCiImageRuntimePromotion,
  isCurrentSourceCandidate,
  localPromotionDecision,
  pendingFirstPinCoversCandidate,
  newestPinState,
  parseCiImageCandidate,
  parseCiImagePinState,
  parsePlaywrightVersionFile,
  playwrightPackageVersion,
  playwrightVersionFromDockerfile,
  PLAYWRIGHT_PACKAGE_TARGETS,
  PLAYWRIGHT_VERSION_FILE,
  rewritePlaywrightPackage,
  serializedState,
  stateFromCandidate,
  verifyDigestFile,
} from "./update-ci-image-pin-core.ts";

const PLAYWRIGHT_CLIENTS = new Set([
  "playwright",
  "playwright-core",
  "@playwright/test",
]);
const PINNED_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

/** Every exact-semver Playwright client pin across the root workspaces. */
async function exactPlaywrightPins(
  repoRoot: URL,
): Promise<{ key: string; version: string }[]> {
  const workspaces = asRecord(
    await Bun.file(new URL("package.json", repoRoot)).json(),
  )?.["workspaces"];
  if (!Array.isArray(workspaces)) {
    throw new TypeError("root package.json has no workspaces array");
  }
  const pins: { key: string; version: string }[] = [];
  for (const workspace of workspaces) {
    const manifestPath = `${String(workspace)}/package.json`;
    const manifest = asRecord(
      await Bun.file(new URL(manifestPath, repoRoot)).json(),
    );
    if (manifest === null) {
      throw new TypeError(`${manifestPath} is not a JSON object`);
    }
    for (const section of PINNED_SECTIONS) {
      for (const [name, version] of Object.entries(
        toStringRecord(manifest[section]),
      )) {
        if (PLAYWRIGHT_CLIENTS.has(name) && /^\d+\.\d+\.\d+$/.test(version)) {
          pins.push({ key: `${manifestPath}#${section}#${name}`, version });
        }
      }
    }
  }
  return pins;
}

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
    "FROM oven/bun:1.4.0@sha256:" + "a".repeat(64) + " AS bun",
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

  test("covers every exact Playwright pin in the workspace at the image version", async () => {
    // A hand-maintained target list drifted twice (v1.62.1, v1.63.0), each
    // time leaving a package on the old client and splitting `Page` types.
    // Derive the expectation from the workspace itself so a new pin fails here.
    const repoRoot = new URL("../../../", import.meta.url);
    const activeVersion = parsePlaywrightVersionFile(
      await Bun.file(new URL(PLAYWRIGHT_VERSION_FILE, repoRoot)).text(),
    );
    const pins = await exactPlaywrightPins(repoRoot);
    const registered = PLAYWRIGHT_PACKAGE_TARGETS.map(
      (target) => `${target.path}#${target.section}#${target.dependency}`,
    );
    expect(pins.map((pin) => pin.key).toSorted()).toEqual(
      registered.toSorted(),
    );
    for (const pin of pins) {
      expect(`${pin.key}@${pin.version}`).toBe(`${pin.key}@${activeVersion}`);
    }
  });

  test("stages the complete atomic package and image promotion", () => {
    expect(ciImagePromotionFiles("ci-playwright")).toEqual([
      "ci/ci-playwright/DIGEST",
      "ci/ci-playwright/STATE.json",
      "ci/ci-playwright/PACKAGE_VERSION",
      "packages/monarch/package.json",
      "packages/sjer.red/package.json",
      // These three pin @playwright/test exactly but were missing from
      // PLAYWRIGHT_PACKAGE_TARGETS, so the v1.62.0 -> v1.62.1 promotion left
      // them behind and design-audit ended up resolving two incompatible
      // playwright-core copies. Promotion must move every exact pin together.
      "packages/scout-for-lol/packages/design-audit/package.json",
      "packages/scout-for-lol/packages/design-system/package.json",
      "packages/alert-dashboard/package.json",
      "packages/scout-for-lol/packages/app/package.json",
      "packages/scout-for-lol/packages/activity/package.json",
      "bun.lock",
    ]);
    expect(ciImagePromotionFiles("ci-base")).toEqual([
      "ci/ci-image/DIGEST",
      "ci/ci-image/STATE.json",
    ]);
    expect(ciImagePromotionFiles("windows-cross-compiler-winui")).toEqual([
      "packages/windows-cross-compiler/images/windows-cross-compiler-winui/DIGEST",
      "packages/windows-cross-compiler/images/windows-cross-compiler-winui/STATE.json",
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

    // All three no-promotion exits against a main pin — digest-equal,
    // older-than-pin, and content-unchanged — route through the one funnel with
    // a distinct reason. The runtime gate reaches it through its skip callback.
    const calls = source.match(/await finalizeSkippedPromotion\(/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(source).toContain(
      'reason: "candidate has no runtime digest change"',
    );
    expect(source).toContain(
      'reason: "candidate is older than the committed pin"',
    );
    expect(source).toMatch(
      /skip: async \(reason\) =>\s+finalizeSkippedPromotion\(\{/,
    );
    const runtimeGate = await Bun.file(
      new URL("update-ci-image-pin-runtime.ts", import.meta.url),
    ).text();
    expect(runtimeGate).toContain(
      'await options.skip("candidate runtime content is unchanged")',
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
    expect(dryRunBlock).toContain("dryRunReport(");
    expect(source).toContain("DRYRUN: would promote");
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

describe("local promotion decision", () => {
  test("promotes the first pin when main has none", () => {
    expect(localPromotionDecision(undefined, state(1, "a"))).toBe("promote");
  });

  test("promotes a newer build with a new digest", () => {
    expect(localPromotionDecision(state(5, "a"), state(6, "b"))).toBe(
      "promote",
    );
  });

  test("skips a candidate whose digest is already pinned", () => {
    expect(localPromotionDecision(state(5, "a"), state(6, "a"))).toBe(
      "no-digest-change",
    );
  });

  test("refuses to replace a newer pin", () => {
    expect(localPromotionDecision(state(7, "a"), state(6, "b"))).toBe(
      "older-than-pin",
    );
  });
});

describe("main-side source fingerprint", () => {
  test("reads sources with checkout conversions so CRLF files match the build", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "ci-image-pin-eol-"));
    const git = (...args: string[]): void => {
      const result = Bun.spawnSync(["git", "-C", repository, ...args]);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.toString());
      }
    };
    try {
      git("init", "--quiet");
      await Bun.write(
        path.join(repository, ".gitattributes"),
        "*.targets text eol=crlf\n",
      );
      await Bun.write(path.join(repository, "a.targets"), "one\ntwo\n");
      git("add", ".");
      git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "--quiet",
        "-m",
        "x",
      );
      await rm(path.join(repository, "a.targets"));
      git("checkout", "--", "a.targets");

      const checkedOut = new Uint8Array(
        await Bun.file(path.join(repository, "a.targets")).arrayBuffer(),
      );
      const fromCommand = Bun.spawnSync([
        ...checkedOutSourceCommand(repository, "HEAD", "a.targets"),
      ]).stdout;
      expect(new TextDecoder().decode(checkedOut)).toBe("one\r\ntwo\r\n");
      expect(new TextDecoder().decode(fromCommand)).toBe("one\r\ntwo\r\n");
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });
});

const pendingRepository = "ghcr.io/example/image";
const pendingReader =
  (fingerprints: Record<string, string>) =>
  async (image: string): Promise<string | undefined> =>
    fingerprints[image.split("@")[1] ?? ""];

describe("pending first pin", () => {
  test("keeps a pending first pin whose runtime matches the rebuild", async () => {
    await expect(
      pendingFirstPinCoversCandidate(
        pendingRepository,
        state(5, "a"),
        state(6, "b"),
        pendingReader({ [digest("a")]: "same", [digest("b")]: "same" }),
      ),
    ).resolves.toBe(true);
  });

  test("replaces a pending first pin when the runtime changed", async () => {
    await expect(
      pendingFirstPinCoversCandidate(
        pendingRepository,
        state(5, "a"),
        state(6, "b"),
        pendingReader({ [digest("a")]: "old", [digest("b")]: "new" }),
      ),
    ).resolves.toBe(false);
  });

  test("promotes when there is no pending first pin", async () => {
    await expect(
      pendingFirstPinCoversCandidate(
        pendingRepository,
        undefined,
        state(6, "b"),
        pendingReader({}),
      ),
    ).resolves.toBe(false);
  });
});
