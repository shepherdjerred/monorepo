import { beforeAll, describe, expect, test } from "vitest";

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

describe("initial package releases", () => {
  test("classifies Home Assistant's configured first release", async () => {
    const policy = NPM_PACKAGE_POLICIES.find(
      (candidate) => candidate.name === "@shepherdjerred/home-assistant",
    );
    if (policy === undefined) {
      throw new Error("Home Assistant policy is missing");
    }

    const decision = await classifyPackageRelease(process.cwd(), policy);

    expect(decision).toMatchObject({
      packageName: "@shepherdjerred/home-assistant",
      latestTag: "initial release",
      eligible: true,
    });
  });
});

describe("historical release regressions", () => {
  beforeAll(async () => {
    await fetchNpmPackageTags(process.cwd());
  });

  test("Webring analytics and TypeDoc-only releases are excluded", async () => {
    const policy = NPM_PACKAGE_POLICIES.find(
      (candidate) => candidate.name === "webring",
    );
    if (policy === undefined) throw new Error("Webring policy is missing");

    const oneNine = await classifyPackageReleaseRange(
      process.cwd(),
      policy,
      "webring-v1.8.0",
      "webring-v1.9.0",
    );
    const oneTen = await classifyPackageReleaseRange(
      process.cwd(),
      policy,
      "webring-v1.9.0",
      "webring-v1.10.0",
    );
    expect(oneNine.eligible).toBe(false);
    expect(oneTen.eligible).toBe(false);
  });

  test("Astro CI and devDependency-only release is excluded", async () => {
    const policy = NPM_PACKAGE_POLICIES.find(
      (candidate) => candidate.name === "astro-opengraph-images",
    );
    if (policy === undefined) throw new Error("Astro policy is missing");

    const decision = await classifyPackageReleaseRange(
      process.cwd(),
      policy,
      "astro-opengraph-images-v1.17.4",
      "astro-opengraph-images-v1.18.0",
    );
    expect(decision.eligible).toBe(false);
  });

  test("missing release tags fail closed", async () => {
    const policy = NPM_PACKAGE_POLICIES[0];
    if (policy === undefined) throw new Error("Npm package policy is missing");

    await expect(
      classifyPackageRelease(process.cwd(), {
        ...policy,
        tagPrefix: "does-not-exist-v",
      }),
    ).rejects.toThrow("No release tag found");
  });
});
