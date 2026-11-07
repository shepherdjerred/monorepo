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

/**
 * What `install:local` compiles on each platform. Windows gets only the
 * standalone `brim` binary: its `sync` verb is the one toolkit feature that
 * runs there (the Scheduled Task's `brim.exe sync push`).
 */
export function buildSteps(
  home: string,
  platform: InstallPlatform,
): BuildStep[] {
  const paths = installPaths(home, platform);
  if (platform === "win32") {
    return [
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
