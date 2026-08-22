import { run } from "./run.ts";
import { z } from "zod";

export type NpmPackagePolicy = {
  readonly name: string;
  readonly path: string;
  readonly packageJsonPath: string;
  readonly tagPrefix: string;
};

export const NPM_PACKAGE_POLICIES: readonly NpmPackagePolicy[] = [
  {
    name: "astro-opengraph-images",
    path: "packages/astro-opengraph-images",
    packageJsonPath: "packages/astro-opengraph-images/package.json",
    tagPrefix: "astro-opengraph-images-v",
  },
  {
    name: "webring",
    path: "packages/webring",
    packageJsonPath: "packages/webring/package.json",
    tagPrefix: "webring-v",
  },
  {
    name: "@shepherdjerred/helm-types",
    path: "packages/homelab/src/helm-types",
    packageJsonPath: "packages/homelab/src/helm-types/package.json",
    tagPrefix: "helm-types-v",
  },
];

export type ConsumerChangeResult = {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
};

export type PackageReleaseDecision = ConsumerChangeResult & {
  readonly packageName: string;
  readonly packagePath: string;
  readonly latestTag: string;
  readonly changedFiles: readonly string[];
};

type JsonObject = Record<string, unknown>;

const JsonObjectSchema = z.record(z.string(), z.unknown());

const IGNORED_PACKAGE_JSON_KEYS = new Set([
  "devDependencies",
  "devEngines",
  "overrides",
  "packageManager",
  "scripts",
  "version",
  "workspaces",
]);

const CONSUMER_PACKAGE_JSON_KEYS = new Set([
  "author",
  "bin",
  "browser",
  "bugs",
  "bundledDependencies",
  "bundleDependencies",
  "config",
  "contributors",
  "cpu",
  "dependencies",
  "description",
  "directories",
  "engines",
  "exports",
  "files",
  "funding",
  "homepage",
  "imports",
  "keywords",
  "libc",
  "license",
  "main",
  "man",
  "module",
  "name",
  "optionalDependencies",
  "os",
  "peerDependencies",
  "peerDependenciesMeta",
  "preferGlobal",
  "private",
  "publishConfig",
  "repository",
  "sideEffects",
  "type",
  "types",
  "typings",
  "typesVersions",
]);

function parsePackageJson(contents: string, source: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Could not parse ${source}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return JsonObjectSchema.parse(parsed);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function packageJsonHasConsumerChange(
  beforeContents: string,
  afterContents: string,
  source: string,
): boolean {
  const before = parsePackageJson(
    beforeContents,
    `${source} at the previous tag`,
  );
  const after = parsePackageJson(afterContents, `${source} at HEAD`);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (IGNORED_PACKAGE_JSON_KEYS.has(key)) continue;
    if (!CONSUMER_PACKAGE_JSON_KEYS.has(key)) {
      throw new Error(
        `Could not classify package metadata key ${key} in ${source}`,
      );
    }
    if (!jsonValuesEqual(before[key], after[key])) return true;
  }
  return false;
}

function relativePackagePath(file: string, packagePath: string): string {
  const prefix = `${packagePath}/`;
  if (!file.startsWith(prefix)) {
    throw new Error(`Changed file ${file} is outside package ${packagePath}`);
  }
  return file.slice(prefix.length);
}

function isTestOrExamplePath(relativePath: string): boolean {
  return (
    /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[^/]+|__tests__|__snapshots__|tests?|testdata|fixtures?|__fixtures__)(?:\/|$)/.test(
      relativePath,
    ) ||
    relativePath.startsWith("examples/") ||
    relativePath.startsWith("example/") ||
    relativePath.startsWith("src/__fixtures__/")
  );
}

function isKnownRepositoryOnlyPath(relativePath: string): boolean {
  const exactPaths = new Set([
    "CHANGELOG.md",
    "AGENTS.md",
    "README.md.tmpl",
    "_summary.md",
    "bun.lock",
    ".jscpd.json",
    ".npmignore",
    "bunfig.toml",
    "eslint.config.ts",
    "generate-readme-core.ts",
    "generate-readme-smoke.test.ts",
    "generate-readme.ts",
    "matomo.js",
    "plausible.js",
    "posthog.js",
    "tsconfig.scripts.json",
    "tsconfig.json",
    "typedoc.json",
  ]);
  const prefixes = [".github/", ".vscode/", "assets/", "ci/", "scripts/"];
  return (
    exactPaths.has(relativePath) ||
    prefixes.some((prefix) => relativePath.startsWith(prefix))
  );
}

export function classifyConsumerChanges(
  packagePath: string,
  changedFiles: readonly string[],
  packageJsonChange: boolean,
): ConsumerChangeResult {
  const reasons: string[] = [];
  for (const file of changedFiles) {
    const relativePath = relativePackagePath(file, packagePath);
    if (relativePath === "package.json") {
      if (packageJsonChange) reasons.push("public package metadata changed");
      continue;
    }
    if (relativePath === "README.md") {
      reasons.push("published README changed");
      continue;
    }
    if (relativePath === "LICENSE") {
      reasons.push("published license changed");
      continue;
    }
    if (isTestOrExamplePath(relativePath)) continue;
    if (isKnownRepositoryOnlyPath(relativePath)) continue;
    if (relativePath.startsWith("src/") || relativePath.startsWith("dist/")) {
      reasons.push(`published source changed: ${relativePath}`);
      continue;
    }
    throw new Error(
      `Could not classify changed file ${file} for npm package ${packagePath}`,
    );
  }
  return { eligible: reasons.length > 0, reasons };
}

async function latestTag(
  root: string,
  policy: NpmPackagePolicy,
): Promise<string> {
  const result = await run(
    ["git", "tag", "--list", `${policy.tagPrefix}*`, "--sort=-version:refname"],
    { cwd: root, capture: true, echoCapturedStdout: false },
  );
  const tag = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (tag === undefined) {
    throw new Error(
      `No release tag found for ${policy.name} with prefix ${policy.tagPrefix}`,
    );
  }
  return tag;
}

async function packageJsonAtTag(
  root: string,
  ref: string,
  packageJsonPath: string,
): Promise<string> {
  const result = await run(["git", "show", `${ref}:${packageJsonPath}`], {
    cwd: root,
    capture: true,
    echoCapturedStdout: false,
  });
  return result.stdout;
}

async function classifyPackageReleaseFromTag(
  root: string,
  policy: NpmPackagePolicy,
  tag: string,
  headRef = "HEAD",
): Promise<PackageReleaseDecision> {
  const changed = await run(
    ["git", "diff", "--name-only", tag, headRef, "--", policy.path],
    { cwd: root, capture: true, echoCapturedStdout: false },
  );
  const changedFiles = changed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const packageJsonChange = changedFiles.includes(policy.packageJsonPath)
    ? packageJsonHasConsumerChange(
        await packageJsonAtTag(root, tag, policy.packageJsonPath),
        await packageJsonAtTag(root, headRef, policy.packageJsonPath),
        policy.packageJsonPath,
      )
    : false;

  const result = classifyConsumerChanges(
    policy.path,
    changedFiles,
    packageJsonChange,
  );
  return {
    packageName: policy.name,
    packagePath: policy.path,
    latestTag: tag,
    changedFiles,
    ...result,
  };
}

export async function classifyPackageRelease(
  root: string,
  policy: NpmPackagePolicy,
): Promise<PackageReleaseDecision> {
  return classifyPackageReleaseFromTag(
    root,
    policy,
    await latestTag(root, policy),
  );
}

export async function classifyPackageReleaseRange(
  root: string,
  policy: NpmPackagePolicy,
  previousTag: string,
  headRef: string,
): Promise<PackageReleaseDecision> {
  return classifyPackageReleaseFromTag(root, policy, previousTag, headRef);
}

export async function classifyAllPackageReleases(
  root: string,
): Promise<readonly PackageReleaseDecision[]> {
  return Promise.all(
    NPM_PACKAGE_POLICIES.map((policy) => classifyPackageRelease(root, policy)),
  );
}
