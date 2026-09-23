import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const JsonObjectSchema = z.record(z.string(), z.unknown());

function jsonObjectOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  const result = JsonObjectSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const value = readJsonFile(filePath);
  const parsed = jsonObjectOrUndefined(value);
  if (parsed === undefined) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  return parsed;
}

function stringRecord(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  const parsed = jsonObjectOrUndefined(value);
  if (parsed === undefined) return result;

  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry === "string") {
      result.set(key, entry);
    }
  }

  return result;
}

function dependencyNames(
  packageJson: Record<string, unknown>,
  sections: readonly string[],
): Set<string> {
  const names = new Set<string>();

  for (const section of sections) {
    for (const name of stringRecord(packageJson[section]).keys()) {
      names.add(name);
    }
  }

  return names;
}

function packagePath(rootDir: string, packageName: string): string {
  return path.join(rootDir, "node_modules", ...packageName.split("/"));
}

function packageJsonPath(rootDir: string, packageName: string): string {
  return path.join(packagePath(rootDir, packageName), "package.json");
}

function isOptionalPeer(
  packageJson: Record<string, unknown>,
  peerName: string,
): boolean {
  const peerMeta = packageJson["peerDependenciesMeta"];
  const parsedPeerMeta = jsonObjectOrUndefined(peerMeta);
  if (parsedPeerMeta === undefined) return false;

  const entry = jsonObjectOrUndefined(parsedPeerMeta[peerName]);
  return entry?.["optional"] === true;
}

function isNativePeerDependency(peerName: string): boolean {
  return peerName === "react-native" || peerName.startsWith("react-native-");
}

function formatList(items: Iterable<string>): string {
  return [...items].sort((a, b) => a.localeCompare(b)).join(", ");
}

const MISE_BUN_PATTERN = /^bun\s*=\s*"([^"]+)"/m;
const POST_CLONE_BUN_TAG_PATTERN = /BUN_INSTALL_TAG="bun-v([^"]+)"/;

/**
 * The Xcode Cloud worker installs its own bun via ci_post_clone.sh instead of
 * using the repo's mise toolchain. An older bun cannot parse newer bun.lock
 * versions (lockfileVersion 2 from bun 1.4 failed every Archive from #92 to
 * #100 with "Unknown lockfile version"), so the script's pin must match the
 * root .mise.toml exactly. Either side being unparseable is a violation, not a
 * skip: a guard that cannot see the pin cannot protect the Archive.
 */
export function findBunVersionDriftMessages(options: {
  miseToml: string;
  postCloneScript: string;
}): string[] {
  const miseVersion = MISE_BUN_PATTERN.exec(options.miseToml)?.[1];
  if (miseVersion === undefined) {
    return [
      'Could not find `bun = "<version>"` in the root .mise.toml; the Xcode Cloud bun pin cannot be validated.',
    ];
  }
  const tagVersion = POST_CLONE_BUN_TAG_PATTERN.exec(
    options.postCloneScript,
  )?.[1];
  if (tagVersion === undefined) {
    return [
      'Could not find BUN_INSTALL_TAG="bun-v<version>" in ios/ci_scripts/ci_post_clone.sh; the Xcode Cloud bun pin cannot be validated.',
    ];
  }
  if (miseVersion !== tagVersion) {
    return [
      `Xcode Cloud installs bun ${tagVersion} but the repo pins bun ${miseVersion} in .mise.toml. Align BUN_INSTALL_TAG in ios/ci_scripts/ci_post_clone.sh — an older bun cannot parse the current bun.lock and fails the Archive during post-clone install.`,
    ];
  }
  return [];
}

export function findMissingNativePeerDependencyMessages(
  appPackageJson: Record<string, unknown>,
  installedPackageJsonByName: Map<string, Record<string, unknown>>,
): string[] {
  const runtimeDependencyNames = dependencyNames(appPackageJson, [
    "dependencies",
  ]);
  const declaredPackageNames = dependencyNames(appPackageJson, [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]);
  const messages: string[] = [];

  for (const dependencyName of runtimeDependencyNames) {
    const dependencyPackageJson =
      installedPackageJsonByName.get(dependencyName);

    if (dependencyPackageJson === undefined) {
      messages.push(
        `${dependencyName} is declared in dependencies but is missing from node_modules. Run bun install --frozen-lockfile (workspace root).`,
      );
      continue;
    }

    const peers = stringRecord(dependencyPackageJson["peerDependencies"]);
    for (const peerName of peers.keys()) {
      if (!isNativePeerDependency(peerName)) continue;
      if (isOptionalPeer(dependencyPackageJson, peerName)) continue;
      if (declaredPackageNames.has(peerName)) continue;

      messages.push(
        `${dependencyName} requires ${peerName}; add ${peerName} to dependencies so React Native autolinking and CocoaPods can see it in Xcode Cloud.`,
      );
    }
  }

  return messages;
}

export function findMissingIosPodspecMessages(
  reactNativeConfig: unknown,
  pathExists: (filePath: string) => boolean,
): string[] {
  const parsedConfig = jsonObjectOrUndefined(reactNativeConfig);
  if (parsedConfig === undefined) {
    return ["React Native CLI config must be a JSON object."];
  }

  const dependencies = jsonObjectOrUndefined(parsedConfig["dependencies"]);
  if (dependencies === undefined) {
    return ["React Native CLI config is missing a dependencies object."];
  }

  const messages: string[] = [];
  for (const [dependencyName, dependencyConfig] of Object.entries(
    dependencies,
  )) {
    const parsedDependencyConfig = jsonObjectOrUndefined(dependencyConfig);
    if (parsedDependencyConfig === undefined) continue;

    const platforms = jsonObjectOrUndefined(
      parsedDependencyConfig["platforms"],
    );
    if (platforms === undefined) continue;

    const ios = platforms["ios"];
    if (ios === null || ios === undefined) continue;
    const parsedIos = jsonObjectOrUndefined(ios);
    if (parsedIos === undefined) {
      messages.push(`${dependencyName} has invalid iOS autolink config.`);
      continue;
    }

    const podspecPath = parsedIos["podspecPath"];
    if (typeof podspecPath !== "string" || podspecPath.length === 0) {
      messages.push(
        `${dependencyName} is autolinked for iOS but has no podspecPath in React Native config.`,
      );
      continue;
    }

    if (!pathExists(podspecPath)) {
      messages.push(
        `${dependencyName} iOS podspec is missing at ${podspecPath}.`,
      );
    }
  }

  return messages;
}

function loadInstalledPackageJsons(
  rootDir: string,
  appPackageJson: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const installedPackageJsonByName = new Map<string, Record<string, unknown>>();
  const declaredPackageNames = dependencyNames(
    appPackageJson,
    DEPENDENCY_SECTIONS,
  );

  for (const packageName of declaredPackageNames) {
    const filePath = packageJsonPath(rootDir, packageName);
    if (!existsSync(filePath)) continue;

    installedPackageJsonByName.set(packageName, readJsonObject(filePath));
  }

  return installedPackageJsonByName;
}

function ensureNodeModules(rootDir: string): string[] {
  const nodeModules = path.join(rootDir, "node_modules");
  if (!existsSync(nodeModules)) {
    return [
      "node_modules is missing. Run bun install --frozen-lockfile (workspace root) before checking iOS native deps.",
    ];
  }

  return statSync(nodeModules).isDirectory()
    ? []
    : ["node_modules exists but is not a directory."];
}

function loadReactNativeConfig(rootDir: string): unknown {
  const executable = path.join(rootDir, "node_modules", ".bin", "react-native");
  const result = spawnSync(executable, ["config"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `react-native config failed with exit code ${result.status ?? "unknown"}:\n${result.stderr}`,
    );
  }

  return JSON.parse(result.stdout);
}

function findRepoRoot(startDir: string): string | undefined {
  let dir: string | undefined = startDir;
  while (dir !== undefined) {
    if (existsSync(path.join(dir, ".mise.toml"))) return dir;
    const parent = path.dirname(dir);
    dir = parent === dir ? undefined : parent;
  }
  return undefined;
}

function main(): void {
  const rootDir = process.cwd();
  const packageJsonPathValue = path.join(rootDir, "package.json");
  const appPackageJson = readJsonObject(packageJsonPathValue);
  const issues = ensureNodeModules(rootDir);

  if (issues.length === 0) {
    const installedPackageJsons = loadInstalledPackageJsons(
      rootDir,
      appPackageJson,
    );
    issues.push(
      ...findMissingNativePeerDependencyMessages(
        appPackageJson,
        installedPackageJsons,
      ),
    );
    issues.push(
      ...findMissingIosPodspecMessages(loadReactNativeConfig(rootDir), (p) =>
        existsSync(p),
      ),
    );
  }

  const repoRoot = findRepoRoot(rootDir);
  if (repoRoot === undefined) {
    issues.push(
      "Could not locate the repository root (.mise.toml) from the current directory; the Xcode Cloud bun pin cannot be validated.",
    );
  } else {
    issues.push(
      ...findBunVersionDriftMessages({
        miseToml: readFileSync(path.join(repoRoot, ".mise.toml"), "utf8"),
        postCloneScript: readFileSync(
          path.join(rootDir, "ios", "ci_scripts", "ci_post_clone.sh"),
          "utf8",
        ),
      }),
    );
  }

  if (issues.length > 0) {
    console.error("iOS native dependency check failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(
    `iOS native dependency check passed for ${formatList(
      dependencyNames(appPackageJson, ["dependencies"]),
    )}`,
  );
}

if (import.meta.main) {
  main();
}
