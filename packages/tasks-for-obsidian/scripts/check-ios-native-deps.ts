import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const JsonObjectSchema = z.record(z.string(), z.unknown());

function jsonObjectOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  const result = JsonObjectSchema.safeParse(value);
  return result.success ? result.data : undefined;
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

/** Validate the native archive producer; legacy RN helpers below retain unit coverage. */
export function findNativeBootstrapMessages(options: {
  miseToml: string;
  postCloneScript: string;
  wrapper: string;
  project: string;
  wrapperExecutable: boolean;
  packageJson: string;
}): string[] {
  const messages = findToolchainMessages(options);
  messages.push(
    ...findWrapperMessages(options.wrapper, options.wrapperExecutable),
  );
  if (
    !/"ios:native:generate"\s*:\s*"ios\/ci_scripts\/mise-native\.sh exec -- xcodegen generate --spec ios\/project\.yml --project ios"/.test(
      options.packageJson,
    )
  ) {
    messages.push(
      "Native project generation must use the tracked pinned Apple bootstrap, without untracked root bin tools.",
    );
  }
  const requirements = [
    [
      'facet_mise="$facet_repo_root/packages/tasks-for-obsidian/ios/ci_scripts/mise-native.sh"',
      "Post-clone must bootstrap the tracked native Apple mise wrapper.",
    ],
    [
      '"$facet_mise" install --yes bun rust aqua:yonaskolb/XcodeGen',
      "Post-clone must install native tools from the root manifest.",
    ],
    [
      "export MISE_EXEC_AUTO_INSTALL=false",
      "Post-clone must keep exec from installing unrelated monorepo tools after its explicit native tool install.",
    ],
    [
      '"$facet_mise" exec -- bun install --frozen-lockfile --ignore-scripts',
      "Post-clone must install the frozen root workspace without lifecycle scripts.",
    ],
    [
      'cd "$facet_repo_root"',
      "Post-clone must install dependencies at the repository root.",
    ],
    [
      "build-xcframework --platform ios --platform ios-sim",
      "Post-clone must build device and simulator Rust slices.",
    ],
    [
      "cargo xtask check-xcframework",
      "Post-clone must verify generated bindings against the XCFramework.",
    ],
    [
      "bun ../tasknotes-macos/scripts/generate-native-notices.ts --ios",
      "Post-clone must bundle locked native third-party license texts.",
    ],
    [
      '"$facet_mise" exec -- xcodegen generate',
      "Post-clone must generate the native project using the shared toolchain.",
    ],
  ] as const;
  for (const [required, message] of requirements) {
    if (!options.postCloneScript.includes(required)) messages.push(message);
  }
  if (
    /BUN_INSTALL_TAG|--linker[ =]hoisted|brew install|pod install|react-native|Metro/.test(
      options.postCloneScript,
    )
  ) {
    messages.push(
      "Post-clone contains a separate tool pin or legacy React Native bootstrap.",
    );
  }
  const appTarget = options.project
    .split("\n  TasksForObsidian:")[1]
    ?.split(/\n {2}[\w-]+:/i)[0];
  if (
    appTarget === undefined ||
    !appTarget.includes("product: TaskNotesFacetUI") ||
    !appTarget.includes("path: Facet") ||
    !appTarget.includes(
      "PRODUCT_BUNDLE_IDENTIFIER: org.reactjs.native.example.TasksForObsidian",
    ) ||
    !options.project.includes(
      "CODE_SIGN_ENTITLEMENTS: TasksWidget/TasksWidget.entitlements",
    )
  ) {
    messages.push(
      "Native release project must preserve the registered app, widget and standalone SwiftUI product.",
    );
  }
  return messages;
}

function findToolchainMessages(options: {
  miseToml: string;
  project: string;
}): string[] {
  const messages: string[] = [];
  for (const tool of ["bun", "rust"]) {
    if (
      !new RegExp(String.raw`^${tool}\s*=\s*"\d+\.\d+\.\d+"`, "m").test(
        options.miseToml,
      )
    ) {
      messages.push(`Root .mise.toml must pin ${tool}.`);
    }
  }
  const xcodeGen =
    /^"aqua:yonaskolb\/XcodeGen"\s*=\s*\{\s*version\s*=\s*"([^"]+)",\s*os\s*=\s*\["macos"\]\s*\}/m.exec(
      options.miseToml,
    )?.[1];
  if (xcodeGen === undefined)
    messages.push("Root XcodeGen pin must be restricted to macOS.");
  if (
    xcodeGen !== undefined &&
    !options.project.includes(`minimumXcodeGenVersion: "${xcodeGen}"`)
  ) {
    messages.push(
      "Native project minimum XcodeGen version must match the root toolchain.",
    );
  }
  return messages;
}

function findWrapperMessages(wrapper: string, executable: boolean): string[] {
  const messages: string[] = [];
  if (!executable)
    messages.push(
      "Shared mise wrapper must be executable in a fresh checkout.",
    );
  if (
    !/mise_version="\d+\.\d+\.\d+"/.test(wrapper) ||
    !wrapper.includes('export MISE_DATA_DIR="$localized_dir"') ||
    !wrapper.includes("shasum -a 256 -c")
  ) {
    messages.push(
      "Shared mise wrapper must pin, localize and verify its bootstrap download.",
    );
  }
  for (const arch of ["x86_64", "arm64"]) {
    if (!new RegExp(`checksum_macos_${arch}="[a-f0-9]{64}`).test(wrapper))
      messages.push(
        `Shared mise wrapper lacks a verified macOS ${arch} asset.`,
      );
  }
  return messages;
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
  const issues: string[] = [];
  const repoRoot = findRepoRoot(rootDir);
  if (repoRoot === undefined) {
    issues.push(
      "Could not locate the repository root (.mise.toml) from the current directory.",
    );
  } else {
    issues.push(
      ...findNativeBootstrapMessages({
        miseToml: readFileSync(path.join(repoRoot, ".mise.toml"), "utf8"),
        postCloneScript: readFileSync(
          path.join(rootDir, "ios", "ci_scripts", "ci_post_clone.sh"),
          "utf8",
        ),
        wrapper: readFileSync(
          path.join(rootDir, "ios", "ci_scripts", "mise-native.sh"),
          "utf8",
        ),
        wrapperExecutable:
          (statSync(path.join(rootDir, "ios", "ci_scripts", "mise-native.sh"))
            .mode &
            0o111) !==
          0,
        project: readFileSync(path.join(rootDir, "ios", "project.yml"), "utf8"),
        packageJson: readFileSync(path.join(rootDir, "package.json"), "utf8"),
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
    "iOS native archive dependency contract passed (shared mise, frozen workspace, Rust slices, SwiftUI and widget identities).",
  );
}

if (import.meta.main) {
  main();
}
