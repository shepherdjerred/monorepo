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
  if (entry === undefined) return false;

  return entry["optional"] === true;
}

function isNativePeerDependency(peerName: string): boolean {
  return peerName === "react-native" || peerName.startsWith("react-native-");
}

function formatList(items: Iterable<string>): string {
  return [...items].sort((a, b) => a.localeCompare(b)).join(", ");
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

  if (!statSync(nodeModules).isDirectory()) {
    return ["node_modules exists but is not a directory."];
  }

  return [];
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
