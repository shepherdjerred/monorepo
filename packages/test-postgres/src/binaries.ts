import path from "node:path";

export const POSTGRES_MAJOR = 18;

export type RunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type CommandRunner = (
  argv: readonly string[],
  env?: Readonly<Record<string, string>>,
) => RunResult;

export function sanitizedEnv(
  overrides?: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const combined = { ...Bun.env, ...overrides };
  const result: Record<string, string> = {};
  for (const [name, val] of Object.entries(combined)) {
    if (name !== "OP_SERVICE_ACCOUNT_TOKEN" && typeof val === "string") {
      result[name] = val;
    }
  }
  return result;
}

export function runCommandSync(
  argv: readonly string[],
  options?: {
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  },
): RunResult {
  const result = Bun.spawnSync([...argv], {
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    env: sanitizedEnv(options?.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export async function runCommandAsync(
  argv: readonly string[],
  options?: {
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  },
): Promise<RunResult> {
  const child = Bun.spawn([...argv], {
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    env: sanitizedEnv(options?.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function compareVersionsDescending(left: string, right: string): number {
  const leftNum = Number.parseFloat(left);
  const rightNum = Number.parseFloat(right);
  return !Number.isNaN(leftNum) && !Number.isNaN(rightNum)
    ? rightNum - leftNum
    : right.localeCompare(left);
}

function versionSubdirectories(
  parentDir: string,
  joinPath: typeof path.join,
  readSubdirs: (dir: string) => readonly string[],
): string[] {
  try {
    return [...readSubdirs(parentDir)]
      .sort(compareVersionsDescending)
      .map((entry) => joinPath(parentDir, entry, "bin"));
  } catch {
    return [];
  }
}

export type BinaryDiscoveryDeps = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly isRoot?: boolean;
  readonly which?: (executable: string) => string | null;
  readonly readSubdirs?: (dir: string) => readonly string[];
  readonly fileExists?: (filePath: string) => boolean;
  readonly run?: CommandRunner;
};

function defaultFileExists(filePath: string): boolean {
  return Bun.file(filePath).size > 0;
}

function defaultReadSubdirs(dir: string): readonly string[] {
  const entries = [
    ...new Bun.Glob("*").scanSync({ cwd: dir, onlyFiles: false }),
  ];
  return entries.filter(
    (entry) =>
      defaultFileExists(path.join(dir, entry, "bin", "postgres")) ||
      defaultFileExists(path.join(dir, entry, "bin", "postgres.exe")) ||
      defaultFileExists(path.join(dir, entry, "bin", "psql")) ||
      defaultFileExists(path.join(dir, entry, "bin", "psql.exe")),
  );
}

export function executableFileName(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" && !name.toLowerCase().endsWith(".exe")
    ? `${name}.exe`
    : name;
}

export function joinForPlatform(
  platform: NodeJS.Platform,
  ...segments: string[]
): string {
  return platform === "win32"
    ? path.win32.join(...segments)
    : path.posix.join(...segments);
}

function dirnameForPlatform(
  platform: NodeJS.Platform,
  targetPath: string,
): string {
  return platform === "win32"
    ? path.win32.dirname(targetPath)
    : path.posix.dirname(targetPath);
}

function platformCandidateDirs(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  readSubdirs: (dir: string) => readonly string[],
): string[] {
  if (platform === "win32") {
    const programFiles = env["ProgramFiles"] ?? String.raw`C:\Program Files`;
    return versionSubdirectories(
      path.win32.join(programFiles, "PostgreSQL"),
      path.win32.join,
      readSubdirs,
    );
  }
  return [
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@17/bin",
    ...versionSubdirectories(
      "/usr/lib/postgresql",
      path.posix.join,
      readSubdirs,
    ),
  ];
}

function probeMisePostgresBinDir(
  run: CommandRunner,
  platform: NodeJS.Platform,
): string | undefined {
  try {
    const miseSelected = run(["mise", "which", "postgres"]);
    if (miseSelected.exitCode !== 0) {
      return undefined;
    }
    const resolved = miseSelected.stdout.trim();
    return resolved === "" ? undefined : dirnameForPlatform(platform, resolved);
  } catch {
    // Optional probe: continue with PATH and standard directories when mise is absent.
    return undefined;
  }
}

export function candidatePostgresBinDirs(
  deps: BinaryDiscoveryDeps = {},
): string[] {
  const env = deps.env ?? Bun.env;
  const platform = deps.platform ?? process.platform;
  const isRoot = deps.isRoot ?? process.getuid?.() === 0;
  const which = deps.which ?? ((exe: string) => Bun.which(exe));
  const readSubdirs = deps.readSubdirs ?? defaultReadSubdirs;
  const run =
    deps.run ?? ((argv, extra) => runCommandSync(argv, { env: extra }));

  const rawCandidates: (string | undefined)[] = [
    env["POSTGRES_BIN_DIR"]?.trim(),
  ];

  if (isRoot && platform !== "win32") {
    rawCandidates.push(probeMisePostgresBinDir(run, platform));
  }

  for (const tool of ["postgres", "psql"]) {
    const fromPath = which(executableFileName(tool, platform));
    if (fromPath !== null) {
      rawCandidates.push(dirnameForPlatform(platform, fromPath));
    }
  }

  rawCandidates.push(...platformCandidateDirs(platform, env, readSubdirs));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of rawCandidates) {
    if (candidate !== undefined && candidate !== "" && !seen.has(candidate)) {
      seen.add(candidate);
      unique.push(candidate);
    }
  }
  return unique;
}

export function parsePostgresMajor(versionOutput: string): number | undefined {
  const match = /\(PostgreSQL\)\s+(\d+)\./u.exec(versionOutput);
  if (match?.[1] === undefined) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export type DiscoveredPostgresBinaries = {
  readonly binDir: string;
  readonly major: number;
  readonly versionOutput: string;
};

let cachedBinaries: DiscoveredPostgresBinaries | undefined;

function probeBinDir(
  binDir: string,
  platform: NodeJS.Platform,
  fileExists: (filePath: string) => boolean,
  run: CommandRunner,
): DiscoveredPostgresBinaries | { readonly error: string } {
  const postgresBin = joinForPlatform(
    platform,
    binDir,
    executableFileName("postgres", platform),
  );
  const psqlBin = joinForPlatform(
    platform,
    binDir,
    executableFileName("psql", platform),
  );
  const hasPostgres = fileExists(postgresBin);
  if (!hasPostgres && !fileExists(psqlBin)) {
    return { error: `${binDir} does not contain postgres or psql` };
  }
  const probeTarget = hasPostgres ? postgresBin : psqlBin;
  const version = run([probeTarget, "--version"]);
  if (version.exitCode !== 0) {
    return {
      error: `${probeTarget} --version exited ${String(version.exitCode)}: ${version.stderr.trim()}`,
    };
  }
  const combined = `${version.stdout}${version.stderr}`.trim();
  const major = parsePostgresMajor(combined);
  return major === undefined
    ? { error: `Cannot parse PostgreSQL major version from: ${combined}` }
    : { binDir, major, versionOutput: combined };
}

export function binariesHint(toolError: string): Error {
  return new Error(
    `${toolError}\nPostgres binaries not found or not working — run \`mise install\` at the repo root ` +
      `(pinned github:theseus-rs/postgresql-binaries in .mise.toml) or set POSTGRES_BIN_DIR.`,
  );
}

function isDefaultDiscoveryOptions(
  options: BinaryDiscoveryDeps & { readonly requiredMajor?: number | null },
): boolean {
  return (
    options.env === undefined &&
    options.platform === undefined &&
    options.isRoot === undefined &&
    options.which === undefined &&
    options.readSubdirs === undefined &&
    options.fileExists === undefined &&
    options.run === undefined &&
    (options.requiredMajor === undefined ||
      options.requiredMajor === POSTGRES_MAJOR)
  );
}

function validateExplicitBinDir(input: {
  readonly explicitDir: string;
  readonly platform: NodeJS.Platform;
  readonly requiredMajor: number | null;
  readonly fileExists: (filePath: string) => boolean;
  readonly run: CommandRunner;
}): DiscoveredPostgresBinaries {
  const { explicitDir, platform, requiredMajor, fileExists, run } = input;
  const probed = probeBinDir(explicitDir, platform, fileExists, run);
  if ("error" in probed) {
    throw binariesHint(
      `POSTGRES_BIN_DIR (${explicitDir}) is unusable: ${probed.error}`,
    );
  }
  if (requiredMajor !== null && probed.major !== requiredMajor) {
    throw binariesHint(
      `POSTGRES_BIN_DIR (${explicitDir}) provides PostgreSQL ${String(probed.major)}, but major ${String(requiredMajor)} is required (${probed.versionOutput})`,
    );
  }
  return probed;
}

function scanCandidateBinDirs(input: {
  readonly candidates: readonly string[];
  readonly platform: NodeJS.Platform;
  readonly requiredMajor: number | null;
  readonly fileExists: (filePath: string) => boolean;
  readonly run: CommandRunner;
}): DiscoveredPostgresBinaries {
  const { candidates, platform, requiredMajor, fileExists, run } = input;
  const diagnostics: string[] = [];
  for (const dir of candidates) {
    const probed = probeBinDir(dir, platform, fileExists, run);
    if ("error" in probed) {
      diagnostics.push(`${dir}: ${probed.error}`);
      continue;
    }
    if (requiredMajor === null || probed.major === requiredMajor) {
      return probed;
    }
    diagnostics.push(
      `${dir}: found PostgreSQL ${String(probed.major)} (${probed.versionOutput}), needed major ${String(requiredMajor)}`,
    );
  }
  const details =
    diagnostics.length > 0
      ? diagnostics.join("\n  ")
      : "no PostgreSQL candidate directories found";
  throw binariesHint(
    `Expected PostgreSQL ${String(requiredMajor ?? POSTGRES_MAJOR)} binaries:\n  ${details}`,
  );
}

export function discoverPostgresBinDir(
  options: BinaryDiscoveryDeps & {
    readonly requiredMajor?: number | null;
  } = {},
): DiscoveredPostgresBinaries {
  const cacheable = isDefaultDiscoveryOptions(options);
  if (cacheable && cachedBinaries !== undefined) {
    return cachedBinaries;
  }

  const env = options.env ?? Bun.env;
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? defaultFileExists;
  const run =
    options.run ?? ((argv, extra) => runCommandSync(argv, { env: extra }));
  const requiredMajor =
    options.requiredMajor === undefined
      ? POSTGRES_MAJOR
      : options.requiredMajor;

  const explicit = env["POSTGRES_BIN_DIR"]?.trim();
  const discovered =
    explicit !== undefined && explicit !== ""
      ? validateExplicitBinDir({
          explicitDir: explicit,
          platform,
          requiredMajor,
          fileExists,
          run,
        })
      : scanCandidateBinDirs({
          candidates: candidatePostgresBinDirs(options),
          platform,
          requiredMajor,
          fileExists,
          run,
        });
  if (cacheable) cachedBinaries = discovered;
  return discovered;
}

export function postgresBinaryPath(
  executable: string,
  options?: { readonly allowAnyMajor?: boolean },
): string {
  const discovered = discoverPostgresBinDir({
    requiredMajor: options?.allowAnyMajor === true ? null : POSTGRES_MAJOR,
  });
  return joinForPlatform(
    process.platform,
    discovered.binDir,
    executableFileName(executable, process.platform),
  );
}

export function envWithPostgresBin(
  overrides?: Readonly<Record<string, string | undefined>>,
  options?: { readonly allowAnyMajor?: boolean },
): Record<string, string> {
  const discovered = discoverPostgresBinDir({
    requiredMajor: options?.allowAnyMajor === true ? null : POSTGRES_MAJOR,
  });
  const base = sanitizedEnv(overrides);
  const delimiter = process.platform === "win32" ? ";" : ":";
  const currentPath = base["PATH"] ?? "";
  base["PATH"] =
    currentPath === ""
      ? discovered.binDir
      : `${discovered.binDir}${delimiter}${currentPath}`;
  return base;
}
