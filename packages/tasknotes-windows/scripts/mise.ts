import path from "node:path";
import { toolchainVersions } from "./toolchain.ts";

export type ProbeOutput = {
  readonly exitCode: number;
  readonly stdout: string;
};

export type MiseResolutionOptions = {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly which?: (command: string) => string | null;
  readonly scanWinGetMisePackages?: (
    packagesDirectory: string,
  ) => Promise<readonly string[]> | readonly string[];
  readonly spawnProbe?: (
    command: readonly string[],
    cwd?: string,
  ) => ProbeOutput;
  readonly readTextFile?: (filePath: string) => Promise<string>;
};

function defaultSpawnProbe(
  command: readonly string[],
  cwd?: string,
): ProbeOutput {
  const result = Bun.spawnSync([...command], {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
  };
}

async function defaultScanWinGetMisePackages(
  packagesDirectory: string,
): Promise<readonly string[]> {
  try {
    const matches = await Array.fromAsync(
      new Bun.Glob("jdx.mise_*/**/mise.exe").scan({
        cwd: packagesDirectory,
        absolute: true,
        onlyFiles: true,
      }),
    );
    return matches.toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function tryProbeExecutable(
  candidate: string,
  args: readonly string[],
  spawnProbe: (command: readonly string[], cwd?: string) => ProbeOutput,
  cwd?: string,
): ProbeOutput | undefined {
  if (candidate.length === 0) {
    return undefined;
  }
  try {
    const result = spawnProbe([candidate, ...args], cwd);
    return result.exitCode === 0 ? result : undefined;
  } catch {
    // Elevated Windows OpenSSH sessions fail with os error 448 ("untrusted
    // mount point") when traversing WinGet symlinks or mise junctions.
    return undefined;
  }
}

async function collectMiseCandidates(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  whichFn: (command: string) => string | null,
  scanWinGet: (
    packagesDirectory: string,
  ) => Promise<readonly string[]> | readonly string[],
): Promise<string[]> {
  const candidates: string[] = [];
  if (platform === "win32") {
    const localAppData = env["LOCALAPPDATA"] ?? "";
    const programFiles = env["ProgramFiles"] ?? String.raw`C:\Program Files`;
    if (localAppData.length > 0) {
      candidates.push(
        path.win32.join(
          localAppData,
          "Microsoft",
          "WinGet",
          "Links",
          "mise.exe",
        ),
      );
      const wingetPackages = path.win32.join(
        localAppData,
        "Microsoft",
        "WinGet",
        "Packages",
      );
      candidates.push(...(await scanWinGet(wingetPackages)));
      candidates.push(path.win32.join(localAppData, "mise", "bin", "mise.exe"));
    }
    if (programFiles.length > 0) {
      candidates.push(path.win32.join(programFiles, "mise", "bin", "mise.exe"));
    }
  }
  const onPath = whichFn("mise");
  if (onPath !== null && !candidates.includes(onPath)) {
    candidates.push(onPath);
  }
  return candidates;
}

export async function resolveMise(
  options: MiseResolutionOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? Bun.env;
  const whichFn = options.which ?? ((cmd: string) => Bun.which(cmd));
  const scanWinGet =
    options.scanWinGetMisePackages ?? defaultScanWinGetMisePackages;
  const spawnProbe = options.spawnProbe ?? defaultSpawnProbe;

  const candidates = await collectMiseCandidates(
    platform,
    env,
    whichFn,
    scanWinGet,
  );
  for (const candidate of candidates) {
    if (
      tryProbeExecutable(candidate, ["--version"], spawnProbe) !== undefined
    ) {
      return candidate;
    }
  }

  throw new Error(
    "mise is missing or unusable in this session. Install it from https://mise.jdx.dev/getting-started.html and reopen the terminal.",
  );
}

function directDotnetCandidates(
  version: string,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const binary = platform === "win32" ? "dotnet.exe" : "dotnet";
  const candidates: string[] = [];
  const miseDataDir = env["MISE_DATA_DIR"] ?? "";
  if (miseDataDir.length > 0) {
    candidates.push(
      pathApi.join(miseDataDir, "installs", "dotnet", version, binary),
    );
  }
  if (platform === "win32") {
    const localAppData = env["LOCALAPPDATA"] ?? "";
    if (localAppData.length > 0) {
      candidates.push(
        pathApi.join(
          localAppData,
          "mise",
          "installs",
          "dotnet",
          version,
          binary,
        ),
      );
    }
  } else {
    const home = env["HOME"] ?? "";
    if (home.length > 0) {
      candidates.push(
        pathApi.join(
          home,
          ".local",
          "share",
          "mise",
          "installs",
          "dotnet",
          version,
          binary,
        ),
      );
    }
  }
  return candidates;
}

export async function resolveDotnetExecutable(
  repositoryRoot: string,
  options: MiseResolutionOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? Bun.env;
  const pathApi = platform === "win32" ? path.win32 : path;
  const binary = platform === "win32" ? "dotnet.exe" : "dotnet";
  const spawnProbe = options.spawnProbe ?? defaultSpawnProbe;
  const readTextFile =
    options.readTextFile ?? ((filePath: string) => Bun.file(filePath).text());

  try {
    const mise = await resolveMise(options);
    const resolved = tryProbeExecutable(
      mise,
      ["where", "dotnet"],
      spawnProbe,
      repositoryRoot,
    );
    const dotnetRoot = resolved?.stdout.trim() ?? "";
    if (dotnetRoot.length > 0) {
      const candidate = pathApi.join(dotnetRoot, binary);
      if (
        tryProbeExecutable(candidate, ["--version"], spawnProbe) !== undefined
      ) {
        return candidate;
      }
    }
  } catch {
    // Fall back to direct .mise.toml install path below when mise or its junctions fail.
  }

  const miseTomlPath = pathApi.join(repositoryRoot, ".mise.toml");
  let pinnedDotnetVersion: string;
  try {
    const parsed = Bun.TOML.parse(await readTextFile(miseTomlPath));
    pinnedDotnetVersion = toolchainVersions(parsed).dotnet;
  } catch (error) {
    throw new Error(
      `Could not resolve .NET SDK via mise or read ${miseTomlPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  for (const candidate of directDotnetCandidates(
    pinnedDotnetVersion,
    platform,
    env,
  )) {
    if (
      tryProbeExecutable(candidate, ["--version"], spawnProbe) !== undefined
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Could not resolve a runnable .NET SDK ${pinnedDotnetVersion} via mise or direct install paths; run mise install at the repository root.`,
  );
}
