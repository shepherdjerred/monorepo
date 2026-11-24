import path from "node:path";

export type InstallPlatform = "darwin" | "linux" | "win32";

export type InstallPaths = {
  readonly binary: string;
  readonly legacyBinary: string;
  readonly brimBinary: string;
};

function pathFor(platform: InstallPlatform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

export function installPaths(
  home: string,
  platform: InstallPlatform = "darwin",
): InstallPaths {
  const bin = pathFor(platform).join(home, ".local", "bin");
  const exe = platform === "win32" ? ".exe" : "";
  return {
    binary: pathFor(platform).join(bin, `toolkit${exe}`),
    legacyBinary: pathFor(platform).join(bin, `tools${exe}`),
    brimBinary: pathFor(platform).join(bin, `brim${exe}`),
  };
}

export type BuildStep = {
  readonly argv: readonly string[];
  /** The compiled file, relative to the package root. */
  readonly output: string;
  /** Where the compiled file is installed. */
  readonly destination: string;
};

export const TOOLKIT_BUILD_INPUT_PATHS = [
  "packages/toolkit",
  "packages/delivery",
  "packages/ops-model",
  "packages/tracker",
  "packages/code-review",
  "packages/version-catalog",
  "packages/config",
  "packages/llm-models",
  "packages/unix-socket-daemon",
  "packages/mc-harness",
] as const;

export type ToolkitBuildStamp = {
  readonly commit: string;
  readonly inputDigest: string;
  readonly builtAt: string;
};

export type GitSyncRunner = (
  args: readonly string[],
  cwd: string,
) => { readonly exitCode: number; readonly stdout: string };

function defaultGitSyncRunner(
  args: readonly string[],
  cwd: string,
): { readonly exitCode: number; readonly stdout: string } {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

export function computeInputTreeDigest(lsTreeOutput: string): string {
  return new Bun.CryptoHasher("sha256")
    .update(lsTreeOutput.trim())
    .digest("hex");
}

export function buildDefineFlags(
  stamp?: ToolkitBuildStamp | null,
): readonly string[] {
  if (stamp == null) {
    return [];
  }
  return [
    "--define",
    `TOOLKIT_BUILD_COMMIT=${JSON.stringify(stamp.commit)}`,
    "--define",
    `TOOLKIT_BUILD_INPUT_DIGEST=${JSON.stringify(stamp.inputDigest)}`,
    "--define",
    `TOOLKIT_BUILT_AT=${JSON.stringify(stamp.builtAt)}`,
  ];
}

export function resolveToolkitBuildStamp(
  cwd: string,
  options: {
    readonly now?: Date | undefined;
    readonly runGit?: GitSyncRunner | undefined;
  } = {},
): ToolkitBuildStamp | null {
  const runGit = options.runGit ?? defaultGitSyncRunner;
  const topRes = runGit(["rev-parse", "--show-toplevel"], cwd);
  const repoRoot = topRes.stdout.trim();
  if (topRes.exitCode !== 0 || repoRoot.length === 0) {
    return null;
  }
  const headRes = runGit(["rev-parse", "HEAD"], repoRoot);
  const commit = headRes.stdout.trim();
  if (headRes.exitCode !== 0 || commit.length === 0) {
    return null;
  }
  const treeRes = runGit(
    ["ls-tree", "HEAD", "--", ...TOOLKIT_BUILD_INPUT_PATHS],
    repoRoot,
  );
  if (treeRes.exitCode !== 0 || treeRes.stdout.trim().length === 0) {
    return null;
  }
  return {
    commit,
    inputDigest: computeInputTreeDigest(treeRes.stdout),
    builtAt: (options.now ?? new Date()).toISOString(),
  };
}

/**
 * What `install:local` compiles on each platform. Windows installs native
 * toolkit.exe and brim.exe; the Scheduled Task keeps using brim.exe sync push.
 */
export function buildSteps(
  home: string,
  platform: InstallPlatform,
  stamp?: ToolkitBuildStamp | null,
): BuildStep[] {
  const paths = installPaths(home, platform);
  const defines = buildDefineFlags(stamp);
  if (platform === "win32") {
    return [
      {
        argv: [
          "bun",
          "build",
          "./src/index.ts",
          "--compile",
          ...defines,
          "--target=bun-windows-x64",
          "--external",
          "ffmpeg-static",
          "--outfile=dist/toolkit.exe",
        ],
        output: "dist/toolkit.exe",
        destination: paths.binary,
      },
      {
        argv: [
          "bun",
          "build",
          "./src/brim.ts",
          "--compile",
          "--target=bun-windows-x64",
          "--outfile=dist/brim.exe",
        ],
        output: "dist/brim.exe",
        destination: paths.brimBinary,
      },
    ];
  }
  return [
    {
      argv: [
        "bun",
        "build",
        "./src/index.ts",
        "--compile",
        ...defines,
        "--external",
        "ffmpeg-static",
        "--outfile=dist/toolkit",
      ],
      output: "dist/toolkit",
      destination: paths.binary,
    },
    {
      argv: [
        "bun",
        "build",
        "./src/brim.ts",
        "--compile",
        "--outfile=dist/brim",
      ],
      output: "dist/brim",
      destination: paths.brimBinary,
    },
  ];
}

export function installPlatform(platform: string): InstallPlatform {
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(`install:local does not support platform ${platform}`);
}

/**
 * The SHA-1 of the one Developer ID Application identity in
 * `security find-identity -v -p codesigning` output.
 *
 * Installed binaries carry this stable signature, not an ad-hoc one: the
 * credential cache's Keychain items trust toolkit by its code signature, and
 * an ad-hoc identity changes on every build, which would block unattended
 * agents on an access prompt. Zero or several matches fail loudly.
 */
export function developerIdIdentity(findIdentityOutput: string): string {
  const matches = findIdentityOutput
    .split("\n")
    .filter((line) => line.includes('"Developer ID Application: '))
    .flatMap((line) => {
      const hash = /\b([0-9A-F]{40})\b/.exec(line)?.[1];
      return hash === undefined ? [] : [hash];
    });
  const unique = [...new Set(matches)];
  if (unique.length === 1 && unique[0] !== undefined) return unique[0];
  throw new Error(
    unique.length === 0
      ? 'install:local needs a "Developer ID Application" signing identity in the login Keychain; see packages/dotfiles/MACOS_FRESH_INSTALL.md'
      : `install:local found ${String(unique.length)} "Developer ID Application" identities; keep exactly one in the login Keychain`,
  );
}

/** codesign argv for an installed binary, e.g. identifier `red.sjer.toolkit`. */
export function codesignArgv(identity: string, destination: string): string[] {
  const name = destination.split("/").at(-1) ?? "toolkit";
  return [
    "codesign",
    "--force",
    "--sign",
    identity,
    "--identifier",
    `red.sjer.${name}`,
    "--timestamp=none",
    destination,
  ];
}
