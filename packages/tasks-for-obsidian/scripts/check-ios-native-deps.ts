import { stat } from "node:fs/promises";
import path from "node:path";

/** Validate the pure-Swift native archive producer for Xcode Cloud and local XcodeGen. */
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
    !/"ios:native:generate"\s*:\s*"ios\/ci_scripts\/mise-native\.sh exec -- xcodegen generate --spec ios\/project\.yml --project ios"/u.test(
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
      '"$facet_mise" install --yes bun aqua:yonaskolb/XcodeGen',
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
      'packages/tasknotes-macos/scripts/generate-native-notices.ts" --ios',
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
    /BUN_INSTALL_TAG|--linker[ =]hoisted|brew install|pod install|react-native|Metro|cargo|rustup|build-xcframework/u.test(
      options.postCloneScript,
    )
  ) {
    messages.push(
      "Post-clone contains a separate tool pin, legacy React Native bootstrap, or retired Rust XCFramework step.",
    );
  }
  const appTarget = options.project
    .split("\n  TasksForObsidian:")[1]
    ?.split(/\n {2}[\w-]+:/iu)[0];
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
      "Native release project must preserve the registered app, widget and shared SwiftUI product.",
    );
  }
  return messages;
}

function findToolchainMessages(options: {
  miseToml: string;
  project: string;
}): string[] {
  const messages: string[] = [];
  if (!/^bun\s*=\s*"\d+\.\d+\.\d+"/mu.test(options.miseToml)) {
    messages.push("Root .mise.toml must pin bun.");
  }
  const xcodeGen =
    /^"aqua:yonaskolb\/XcodeGen"\s*=\s*\{\s*version\s*=\s*"([^"]+)",\s*os\s*=\s*\["macos"\]\s*\}/mu.exec(
      options.miseToml,
    )?.[1];
  if (xcodeGen === undefined) {
    messages.push("Root XcodeGen pin must be restricted to macOS.");
  }
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
  if (!executable) {
    messages.push(
      "Shared mise wrapper must be executable in a fresh checkout.",
    );
  }
  if (
    !/mise_version="\d+\.\d+\.\d+"/u.test(wrapper) ||
    !wrapper.includes('export MISE_DATA_DIR="$localized_dir"') ||
    !wrapper.includes("shasum -a 256 -c")
  ) {
    messages.push(
      "Shared mise wrapper must pin, localize and verify its bootstrap download.",
    );
  }
  for (const arch of ["x86_64", "arm64"]) {
    if (
      !new RegExp(`checksum_macos_${arch}="[a-f0-9]{64}`, "u").test(wrapper)
    ) {
      messages.push(
        `Shared mise wrapper lacks a verified macOS ${arch} asset.`,
      );
    }
  }
  return messages;
}

async function findRepoRoot(startDir: string): Promise<string | undefined> {
  let dir: string | undefined = startDir;
  while (dir !== undefined) {
    if (await Bun.file(path.join(dir, ".mise.toml")).exists()) return dir;
    const parent = path.dirname(dir);
    dir = parent === dir ? undefined : parent;
  }
  return undefined;
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const issues: string[] = [];
  const repoRoot = await findRepoRoot(rootDir);
  if (repoRoot === undefined) {
    issues.push(
      "Could not locate the repository root (.mise.toml) from the current directory.",
    );
  } else {
    const wrapperPath = path.join(
      rootDir,
      "ios",
      "ci_scripts",
      "mise-native.sh",
    );
    const [
      miseToml,
      postCloneScript,
      wrapper,
      wrapperStat,
      project,
      packageJson,
    ] = await Promise.all([
      Bun.file(path.join(repoRoot, ".mise.toml")).text(),
      Bun.file(
        path.join(rootDir, "ios", "ci_scripts", "ci_post_clone.sh"),
      ).text(),
      Bun.file(wrapperPath).text(),
      stat(wrapperPath),
      Bun.file(path.join(rootDir, "ios", "project.yml")).text(),
      Bun.file(path.join(rootDir, "package.json")).text(),
    ]);
    issues.push(
      ...findNativeBootstrapMessages({
        miseToml,
        postCloneScript,
        wrapper,
        wrapperExecutable: (wrapperStat.mode & 0o111) !== 0,
        project,
        packageJson,
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
    "iOS native archive dependency contract passed (shared mise, frozen workspace, pure-Swift notices, SwiftUI and widget identities).",
  );
}

if (import.meta.main) {
  await main();
}
