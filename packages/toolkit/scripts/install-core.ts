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
