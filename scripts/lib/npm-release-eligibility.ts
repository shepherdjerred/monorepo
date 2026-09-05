import { minimatch } from "minimatch";
import { z } from "zod";

import { run } from "./run.ts";

export type NpmPackagePolicy = {
  readonly name: string;
  readonly path: string;
  readonly packageJsonPath: string;
  readonly tagPrefix: string;
  readonly initialVersion?: string;
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
  {
    name: "@shepherdjerred/home-assistant",
    path: "packages/home-assistant",
    packageJsonPath: "packages/home-assistant/package.json",
    tagPrefix: "home-assistant-v",
    initialVersion: "0.1.0",
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
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  }
  const leftObject = JsonObjectSchema.safeParse(left);
  const rightObject = JsonObjectSchema.safeParse(right);
  if (leftObject.success && rightObject.success) {
    const leftKeys = Object.keys(leftObject.data);
    const rightKeys = Object.keys(rightObject.data);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.hasOwn(rightObject.data, key) &&
          jsonValuesEqual(leftObject.data[key], rightObject.data[key]),
      )
    );
  }
  return false;
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

function isIncludedByPackageFiles(
  relativePath: string,
  publishedFiles: readonly string[],
): boolean {
  const patterns = publishedFiles.map((pattern) => {
    const isNegative = pattern.startsWith("!");
    const value = (isNegative ? pattern.slice(1) : pattern).replace(/\/+$/, "");
    return { isNegative, value };
  });
  const matches = (pattern: string): boolean => {
    if (minimatch(relativePath, pattern, { dot: true })) return true;
    if (/[!*?[\]{}()]/.test(pattern)) return false;
    return minimatch(relativePath, `${pattern}/**`, { dot: true });
  };
  const included = patterns.some(
    ({ isNegative, value }) => !isNegative && matches(value),
  );
  const excluded = patterns.some(
    ({ isNegative, value }) => isNegative && matches(value),
  );
  return included && !excluded;
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
    ".gitignore",
    "_summary.md",
    "bun.lock",
    ".jscpd.json",
    ".npmignore",
    "bunfig.toml",
    "eslint.config.ts",
    "eslint-suppressions.json",
    "generate-readme-core.ts",
    "generate-readme-smoke.test.ts",
    "generate-readme.ts",
    "mise.toml",
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
  publishedFiles?: readonly string[],
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
    if (
      publishedFiles !== undefined &&
      !isIncludedByPackageFiles(relativePath, publishedFiles)
    ) {
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

export async function fetchNpmPackageTags(
  root: string,
  env: Record<string, string> = {},
): Promise<void> {
  for (const policy of NPM_PACKAGE_POLICIES) {
    const tagRef = `refs/tags/${policy.tagPrefix}*`;
    await run(["git", "fetch", "--no-tags", "origin", `${tagRef}:${tagRef}`], {
      cwd: root,
      env,
    });
  }
}

export async function fetchReleaseTarget(
  root: string,
  env: Record<string, string> = {},
  branch = "main",
): Promise<string> {
  const remoteRef = `refs/heads/${branch}`;
  const remote = await run(["git", "ls-remote", "origin", remoteRef], {
    cwd: root,
    env,
    capture: true,
    echoCapturedStdout: false,
  });
  const remoteSha = remote.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .find((value) => value !== undefined && /^[0-9a-f]{40}$/.test(value));
  if (remoteSha === undefined) {
    throw new Error(`Could not resolve origin/${branch} for release preflight`);
  }

  const localRef = `refs/remotes/origin/${branch}`;
  await run(
    ["git", "fetch", "--no-tags", "origin", `${remoteRef}:${localRef}`],
    {
      cwd: root,
      env,
    },
  );
  const local = await run(["git", "rev-parse", localRef], {
    cwd: root,
    capture: true,
    echoCapturedStdout: false,
  });
  const localSha = local.stdout.trim();
  if (localSha !== remoteSha) {
    throw new Error(
      `origin/${branch} moved while release preflight fetched it ` +
        `(${remoteSha} -> ${localSha}); retry the release lane`,
    );
  }
  return remoteSha;
}

async function latestTag(
  root: string,
  policy: NpmPackagePolicy,
): Promise<string | undefined> {
  const result = await run(
    ["git", "tag", "--list", `${policy.tagPrefix}*`, "--sort=-version:refname"],
    { cwd: root, capture: true, echoCapturedStdout: false },
  );
  const tag = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (tag === undefined) {
    if (policy.initialVersion !== undefined) {
      return undefined;
    }
    throw new Error(
      `No release tag found for ${policy.name} with prefix ${policy.tagPrefix}`,
    );
  }
  return tag;
}

async function classifyInitialPackageRelease(
  root: string,
  policy: NpmPackagePolicy,
  headRef: string,
): Promise<PackageReleaseDecision> {
  if (policy.initialVersion === undefined) {
    throw new Error(`No initial release configured for ${policy.name}`);
  }
  const packageJson = parsePackageJson(
    await packageJsonAtTag(root, headRef, policy.packageJsonPath),
    policy.packageJsonPath,
  );
  const version = packageJson["version"];
  if (version !== policy.initialVersion) {
    throw new Error(
      `${policy.name} has no release tag but package.json version is ${String(version)}; ` +
        `expected initial version ${policy.initialVersion}`,
    );
  }
  return {
    packageName: policy.name,
    packagePath: policy.path,
    latestTag: "initial release",
    changedFiles: [policy.packageJsonPath],
    eligible: true,
    reasons: [`initial ${policy.initialVersion} release pending`],
  };
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
    [
      "git",
      "diff",
      "--no-renames",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      tag,
      headRef,
      "--",
      policy.path,
    ],
    { cwd: root, capture: true, echoCapturedStdout: false },
  );
  const changedFiles = changed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const headPackageJson = await packageJsonAtTag(
    root,
    headRef,
    policy.packageJsonPath,
  );
  const packageJsonChange = changedFiles.includes(policy.packageJsonPath)
    ? packageJsonHasConsumerChange(
        await packageJsonAtTag(root, tag, policy.packageJsonPath),
        headPackageJson,
        policy.packageJsonPath,
      )
    : false;
  const publishedFiles = z
    .array(z.string())
    .optional()
    .parse(parsePackageJson(headPackageJson, policy.packageJsonPath)["files"]);

  const result = classifyConsumerChanges(
    policy.path,
    changedFiles,
    packageJsonChange,
    publishedFiles,
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
  const tag = await latestTag(root, policy);
  return tag === undefined
    ? classifyInitialPackageRelease(root, policy, "HEAD")
    : classifyPackageReleaseFromTag(root, policy, tag);
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
  headRef = "HEAD",
): Promise<readonly PackageReleaseDecision[]> {
  return Promise.all(
    NPM_PACKAGE_POLICIES.map(async (policy) =>
      (async () => {
        const tag = await latestTag(root, policy);
        return tag === undefined
          ? classifyInitialPackageRelease(root, policy, headRef)
          : classifyPackageReleaseFromTag(root, policy, tag, headRef);
      })(),
    ),
  );
}
