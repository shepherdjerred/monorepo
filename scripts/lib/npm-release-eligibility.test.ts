import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import releaseHistory from "./__fixtures__/npm-release-history.json";

import {
  classifyConsumerChanges,
  classifyPackageRelease,
  classifyPackageReleaseRange,
  fetchNpmPackageTags,
  NPM_PACKAGE_POLICIES,
  packageJsonHasConsumerChange,
} from "./npm-release-eligibility.ts";

const webringPath = "packages/webring";
const astroPath = "packages/astro-opengraph-images";

describe("package JSON consumer changes", () => {
  test("ignores development-only package metadata", () => {
    expect(
      packageJsonHasConsumerChange(
        JSON.stringify({
          version: "1.0.0",
          scripts: { test: "bun test" },
          devDependencies: { typescript: "^6.0.0" },
          overrides: { zod: "^4.0.0" },
        }),
        JSON.stringify({
          version: "1.0.1",
          scripts: { test: "bun test --coverage" },
          devDependencies: { typescript: "^7.0.0" },
          overrides: { zod: "^4.1.0" },
        }),
        "package.json",
      ),
    ).toBe(false);
  });

  test("recognizes runtime and public metadata changes", () => {
    expect(
      packageJsonHasConsumerChange(
        JSON.stringify({ dependencies: { zod: "^4.0.0" } }),
        JSON.stringify({ dependencies: { zod: "^4.1.0" } }),
        "package.json",
      ),
    ).toBe(true);
    expect(
      packageJsonHasConsumerChange(
        JSON.stringify({ exports: { ".": "./dist/index.js" } }),
        JSON.stringify({ exports: { ".": "./dist/main.js" } }),
        "package.json",
      ),
    ).toBe(true);
    expect(
      packageJsonHasConsumerChange(
        JSON.stringify({ peerDependencies: { astro: "^4.0.0" } }),
        JSON.stringify({ peerDependencies: { astro: "^5.0.0" } }),
        "package.json",
      ),
    ).toBe(true);
  });

  test("ignores JSON object key reordering", () => {
    expect(
      packageJsonHasConsumerChange(
        JSON.stringify({
          dependencies: { zod: "^4.0.0", hono: "^4.0.0" },
          exports: {
            ".": "./dist/index.js",
            "./package.json": "./package.json",
          },
        }),
        JSON.stringify({
          exports: {
            "./package.json": "./package.json",
            ".": "./dist/index.js",
          },
          dependencies: { hono: "^4.0.0", zod: "^4.0.0" },
        }),
        "package.json",
      ),
    ).toBe(false);
  });

  test("fails closed on malformed package metadata", () => {
    expect(() =>
      packageJsonHasConsumerChange("not-json", "{}", "package.json"),
    ).toThrow("Could not parse package.json");
  });

  test("fails closed on an unknown package metadata key", () => {
    expect(() =>
      packageJsonHasConsumerChange(
        JSON.stringify({ internalBuildMode: "old" }),
        JSON.stringify({ internalBuildMode: "new" }),
        "package.json",
      ),
    ).toThrow("Could not classify package metadata key");
  });
});

describe("consumer file classification", () => {
  test("recognizes source, README, and license changes", () => {
    expect(
      classifyConsumerChanges(
        astroPath,
        [
          `${astroPath}/src/index.ts`,
          `${astroPath}/README.md`,
          `${astroPath}/LICENSE`,
        ],
        false,
      ).eligible,
    ).toBe(true);
  });

  test("recognizes deleted published files", () => {
    expect(
      classifyConsumerChanges(
        astroPath,
        [`${astroPath}/dist/index.js`],
        false,
        ["dist", "src", "package.json", "README.md", "LICENSE"],
      ).eligible,
    ).toBe(true);
  });

  test("ignores repository-only, tests, examples, and lockfiles", () => {
    expect(
      classifyConsumerChanges(
        webringPath,
        [
          `${webringPath}/CHANGELOG.md`,
          `${webringPath}/typedoc.json`,
          `${webringPath}/posthog.js`,
          `${webringPath}/bun.lock`,
          `${webringPath}/src/index.test.ts`,
          `${webringPath}/src/parser.spec.ts`,
          `${webringPath}/src/testdata/rss.xml`,
          `${webringPath}/examples/demo.ts`,
          `${webringPath}/demos/demo.cast`,
          `${webringPath}/demo/record.sh`,
          `${webringPath}/.github/workflows/ci.yml`,
          `${webringPath}/tsconfig.json`,
          `${webringPath}/eslint.config.ts`,
          `${webringPath}/eslint-suppressions.json`,
        ],
        false,
      ).eligible,
    ).toBe(false);
  });

  test("treats mixed internal and consumer changes as eligible", () => {
    expect(
      classifyConsumerChanges(
        webringPath,
        [`${webringPath}/typedoc.json`, `${webringPath}/src/index.ts`],
        false,
      ).eligible,
    ).toBe(true);
  });

  test("ignores files excluded by the package files list", () => {
    expect(
      classifyConsumerChanges(
        webringPath,
        [`${webringPath}/legacy-entrypoint.js`],
        false,
        ["dist", "src", "package.json", "README.md", "LICENSE"],
      ).eligible,
    ).toBe(false);
  });

  test("matches glob and negated package files entries", () => {
    expect(
      classifyConsumerChanges(
        astroPath,
        [
          `${astroPath}/dist/index.js`,
          `${astroPath}/dist/index.test.js`,
          `${astroPath}/src/internal/generated.ts`,
        ],
        false,
        ["dist/*.js", "src", "!src/internal/**"],
      ).reasons,
    ).toEqual(["published source changed: dist/index.js"]);
  });

  test("fails closed on an unknown package file", () => {
    expect(() =>
      classifyConsumerChanges(astroPath, [`${astroPath}/unknown.yaml`], false),
    ).toThrow("Could not classify changed file");
  });
});

describe("tagless packages", () => {
  test("fails loudly when a published package has no release tag", async () => {
    const policy = NPM_PACKAGE_POLICIES.find(
      (candidate) => candidate.name === "@shepherdjerred/home-assistant",
    );
    if (policy === undefined) {
      throw new Error("Home Assistant policy is missing");
    }

    const root = await mkdtemp(path.join(tmpdir(), "npm-release-eligibility-"));
    const packagePath = path.join(root, policy.path, "package.json");
    try {
      await mkdir(path.join(root, policy.path), { recursive: true });
      await Bun.write(
        packagePath,
        JSON.stringify({ name: policy.name, version: "0.1.0" }, null, 2) + "\n",
      );
      await Bun.$`git -C ${root} init --quiet`;
      await Bun.$`git -C ${root} add ${path.join(policy.path, "package.json")}`;
      await Bun.$`git -C ${root} -c user.name=eligibility-test -c user.email=eligibility-test@example.com commit --quiet -m initial`;

      await expect(classifyPackageRelease(root, policy)).rejects.toThrow(
        "No release tag found for @shepherdjerred/home-assistant",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function fixtureGit(root: string, ...args: string[]): Promise<void> {
  await Bun.$`git -C ${root} ${args}`.quiet();
}

type HistoricalReleaseFixture = (typeof releaseHistory)[number];

async function writeHistoricalTree(
  root: string,
  fixture: HistoricalReleaseFixture,
  after: boolean,
): Promise<void> {
  for (const change of fixture.changes) {
    if (change.path === `${fixture.packagePath}/package.json`) continue;
    if (!after && change.status === "A") continue;
    const file = path.join(root, change.path);
    if (after && change.status === "D") {
      await rm(file);
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await Bun.write(file, after ? "after\n" : "before\n");
    }
  }
  await Bun.write(
    path.join(root, fixture.packagePath, "package.json"),
    JSON.stringify(
      after ? fixture.afterPackageJson : fixture.beforePackageJson,
    ),
  );
}

// Captured manifests and name/status diffs retain the historical input to the
// classifier. It reads file names and package.json, not other file contents.
// The fixture records both original commit IDs for reproducible provenance.
async function historicalRepository(
  fixture: HistoricalReleaseFixture,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "npm-release-history-"));
  try {
    await fixtureGit(root, "init", "--quiet");
    for (const [after, tag] of [
      [false, fixture.previousTag],
      [true, fixture.tag],
    ] as const) {
      await writeHistoricalTree(root, fixture, after);
      await fixtureGit(root, "add", ".");
      await fixtureGit(
        root,
        "-c",
        "user.name=eligibility-test",
        "-c",
        "user.email=eligibility-test@example.com",
        "commit",
        "--quiet",
        "-m",
        tag,
      );
      await fixtureGit(root, "tag", tag);
    }
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

describe("historical release regressions", () => {
  test.each(releaseHistory)("$name is excluded", async (fixture) => {
    const policy = NPM_PACKAGE_POLICIES.find(
      (candidate) => candidate.name === fixture.packageName,
    );
    if (policy === undefined) throw new Error("Package policy is missing");
    const root = await historicalRepository(fixture);
    try {
      const decision = await classifyPackageReleaseRange(
        root,
        policy,
        fixture.previousTag,
        fixture.tag,
      );
      expect(decision.eligible).toBe(false);
      expect(decision.reasons).toEqual([]);
      expect(decision.changedFiles).toEqual(
        fixture.changes.map((change) => change.path).toSorted(),
      );
      await expect(
        classifyPackageRelease(root, {
          ...policy,
          tagPrefix: "does-not-exist-v",
        }),
      ).rejects.toThrow("No release tag found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fetches package tags from a local Git remote", async () => {
    const fixture = releaseHistory[0];
    if (fixture === undefined) throw new Error("Release fixture is missing");
    const origin = await historicalRepository(fixture);
    const root = await mkdtemp(path.join(tmpdir(), "npm-release-fetch-"));
    try {
      await fixtureGit(root, "init", "--quiet");
      await fixtureGit(root, "remote", "add", "origin", origin);
      await fetchNpmPackageTags(root);
      const tags = await Bun.$`git -C ${root} tag --list`.text();
      expect(tags.trim().split("\n").toSorted()).toEqual(
        [fixture.previousTag, fixture.tag].toSorted(),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(origin, { recursive: true, force: true });
    }
  });
});
