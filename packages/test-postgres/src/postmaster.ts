import path from "node:path";
import {
  binariesHint,
  POSTGRES_MAJOR,
  postgresBinaryPath,
  runCommandSync,
  type RunResult,
} from "./binaries.ts";
import { processIsAlive } from "./owner.ts";
import { readFileBytesSync, readFileTextSync } from "./read-sync.ts";

export const DISPOSABLE_TEST_PG_DIR_NAME = "monorepo-test-pg";

export type PostgresClusterDurability = "disposable" | "durable";

const MAX_TAIL_BYTES = 65_536;

const WAL_STARTUP_PANIC_PATTERNS = [
  /\bPANIC:/u,
  /could not locate a valid checkpoint record/iu,
  /invalid checkpoint record/iu,
] as const;

export type PostmasterPidInfo = {
  readonly pid: number;
  readonly port: number;
};

export function parsePostmasterPid(
  contents: string,
): PostmasterPidInfo | undefined {
  const lines = contents.split(/\r?\n/u);
  const rawPid = lines[0]?.trim();
  const rawPort = lines[3]?.trim();
  if (
    rawPid === undefined ||
    rawPid === "" ||
    rawPort === undefined ||
    rawPort === ""
  ) {
    return undefined;
  }
  if (!/^\d+$/u.test(rawPid) || !/^\d+$/u.test(rawPort)) {
    return undefined;
  }
  const pid = Number.parseInt(rawPid, 10);
  const port = Number.parseInt(rawPort, 10);
  return !Number.isInteger(pid) ||
    pid <= 0 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
    ? undefined
    : { pid, port };
}

export function readPostmasterPid(
  dataDir: string,
): PostmasterPidInfo | undefined {
  const pidFile = path.join(dataDir, "postmaster.pid");
  try {
    return Bun.file(pidFile).size === 0
      ? undefined
      : parsePostmasterPid(readFileTextSync(pidFile));
  } catch {
    return undefined;
  }
}

export function canonicalPathIfExists(targetPath: string): string {
  if (process.platform === "win32") {
    return path.resolve(targetPath);
  }
  const resolved = runCommandSync(["realpath", targetPath]);
  return resolved.exitCode === 0
    ? resolved.stdout.trim()
    : path.resolve(targetPath);
}

function normalizeSlashes(targetPath: string): string {
  const forward = targetPath.replaceAll("\\", "/");
  return forward.length > 1 ? forward.replace(/\/+$/u, "") : forward;
}

function endsWithDisposablePgDataSuffix(
  candidatePath: string,
  major: number,
): boolean {
  const suffix = `/${DISPOSABLE_TEST_PG_DIR_NAME}/${major.toString()}/pgdata`;
  const normalized = normalizeSlashes(candidatePath);
  return (
    normalized.length > suffix.length &&
    normalized.endsWith(suffix) &&
    !normalized.split("/").includes("..")
  );
}

export function isDisposableTestPgDataDir(
  dataDir: string,
  options?: {
    readonly major?: number;
    readonly resolveCanonical?: (target: string) => string;
  },
): boolean {
  if (dataDir.trim() === "") {
    return false;
  }
  const major = options?.major ?? POSTGRES_MAJOR;
  const resolved = path.resolve(dataDir);
  if (!endsWithDisposablePgDataSuffix(resolved, major)) {
    return false;
  }
  const canonical = (options?.resolveCanonical ?? canonicalPathIfExists)(
    resolved,
  );
  return endsWithDisposablePgDataSuffix(canonical, major);
}

export function assertDisposableTestPgDataDir(
  dataDir: string,
  options?: {
    readonly major?: number;
    readonly resolveCanonical?: (target: string) => string;
  },
): void {
  const major = options?.major ?? POSTGRES_MAJOR;
  if (!isDisposableTestPgDataDir(dataDir, options)) {
    throw new Error(
      `Refusing to wipe non-disposable PostgreSQL data directory ${dataDir} (must end with ${DISPOSABLE_TEST_PG_DIR_NAME}/${major.toString()}/pgdata)`,
    );
  }
}

export function hasStartupWalPanic(logText: string): boolean {
  return WAL_STARTUP_PANIC_PATTERNS.some((pattern) => pattern.test(logText));
}

export function pgCtlOptionsForDurability(
  port: number,
  durability: PostgresClusterDurability,
): string {
  const durabilityFlags =
    durability === "durable"
      ? "-c fsync=on -c synchronous_commit=on -c full_page_writes=on"
      : "-c fsync=off -c synchronous_commit=off -c full_page_writes=off";
  return `-p ${port.toString()} -c listen_addresses=127.0.0.1 ${durabilityFlags} -c max_connections=200 -c timezone=UTC`;
}

export function runsAsRoot(): boolean {
  return process.getuid?.() === 0;
}

export function asPostgresOwner(cmd: readonly string[]): string[] {
  if (!runsAsRoot()) {
    return [...cmd];
  }
  const su = Bun.which("su");
  if (su === null) {
    throw new Error("Root-hosted Postgres tests require su");
  }
  const quoted = cmd
    .map((value) => `'${value.replaceAll("'", String.raw`'\''`)}'`)
    .join(" ");
  return [su, "-s", "/bin/sh", "nobody", "-c", quoted];
}

export function runAsPostgresOwner(
  cmd: readonly string[],
  options?: {
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  },
): RunResult {
  return runCommandSync(asPostgresOwner(cmd), options);
}

export function serverIsUp(port: number): boolean {
  const args = [
    postgresBinaryPath("pg_isready"),
    "-h",
    "127.0.0.1",
    "-p",
    port.toString(),
    "-q",
  ];
  return runCommandSync(args).exitCode === 0;
}

export function pgCtlServerRunning(dataDir: string): boolean {
  const status = runAsPostgresOwner([
    postgresBinaryPath("pg_ctl"),
    "-D",
    dataDir,
    "status",
  ]);
  return status.exitCode === 0;
}

export function ensureRootOwnershipSync(dataRoot: string): void {
  if (!runsAsRoot()) {
    return;
  }
  const ownership = runCommandSync(["chown", "-R", "nobody", dataRoot]);
  if (ownership.exitCode !== 0) {
    throw binariesHint(
      `chown failed for the Postgres data root: ${ownership.stderr}`,
    );
  }
}

export function ensureDirectorySync(dir: string): void {
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "if", "not", "exist", dir, "mkdir", dir]
      : ["mkdir", "-p", dir];
  runCommandSync(cmd);
}

export function acquireLock(lockDir: string): boolean {
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "mkdir", lockDir]
      : ["mkdir", lockDir];
  if (runCommandSync(cmd).exitCode !== 0) {
    return false;
  }
  const pidPath = path.join(lockDir, "pid");
  const writeCmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", `echo ${process.pid.toString()}> "${pidPath}"`]
      : [
          "sh",
          "-c",
          String.raw`printf '%s\n' "${process.pid.toString()}" > "${pidPath}"`,
        ];
  runCommandSync(writeCmd);
  return true;
}

export function releaseLock(lockDir: string): void {
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "rmdir", "/s", "/q", lockDir]
      : ["rm", "-rf", lockDir];
  runCommandSync(cmd);
}

export function lockIsStale(lockDir: string, staleMs: number): boolean {
  const pidMtime = Bun.file(path.join(lockDir, "pid")).lastModified;
  const mtime = pidMtime > 0 ? pidMtime : Bun.file(lockDir).lastModified;
  return mtime > 0 && Date.now() - mtime > staleMs;
}

function readLogTailSync(logPath: string, maxBytes = MAX_TAIL_BYTES): string {
  try {
    if (Bun.file(logPath).size === 0) {
      return "";
    }
    const bytes = readFileBytesSync(logPath);
    const slice =
      bytes.byteLength > maxBytes
        ? bytes.subarray(bytes.byteLength - maxBytes)
        : bytes;
    return new TextDecoder().decode(slice);
  } catch {
    return "";
  }
}

function rotateLogFileSync(logPath: string): void {
  if (Bun.file(logPath).size === 0) {
    return;
  }
  const recoveredPath = `${logPath}.recovered`;
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "move", "/y", logPath, recoveredPath]
      : ["mv", "-f", logPath, recoveredPath];
  runCommandSync(cmd);
}

function hasLivePostmasterPid(dataDir: string): boolean {
  const pidInfo = readPostmasterPid(dataDir);
  return pidInfo !== undefined && processIsAlive(pidInfo.pid);
}

function removeDisposableDataDirSync(dataDir: string): void {
  assertDisposableTestPgDataDir(dataDir);
  const resolved = path.resolve(dataDir);
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "rmdir", "/s", "/q", resolved]
      : ["rm", "-rf", resolved];
  const removed = runCommandSync(cmd);
  if (removed.exitCode !== 0) {
    throw new Error(
      `Failed to delete corrupt disposable PostgreSQL data directory ${resolved}: ${removed.stderr}`,
    );
  }
}

function runInitdb(dataDir: string): void {
  const init = runAsPostgresOwner(
    [
      postgresBinaryPath("initdb"),
      "-D",
      dataDir,
      "-U",
      "scout",
      "--auth=trust",
      "--encoding=UTF8",
      "--no-locale",
      "--data-checksums",
    ],
    { env: { TZ: "UTC" } },
  );
  if (init.exitCode !== 0) {
    throw binariesHint(`initdb failed: ${init.stderr}`);
  }
}

function ensureInitializedDataDir(dataDir: string): void {
  const versionFile = path.join(dataDir, "PG_VERSION");
  if (Bun.file(versionFile).size > 0) {
    const stored = readFileTextSync(versionFile).trim();
    if (stored !== POSTGRES_MAJOR.toString()) {
      throw new Error(
        `Refusing to start an unreadable or different PostgreSQL major (${stored}) from ${dataDir}`,
      );
    }
    return;
  }
  runInitdb(dataDir);
}

function startClusterOnce(
  port: number,
  dataDir: string,
  logPath: string,
  durability: PostgresClusterDurability,
): RunResult {
  return runAsPostgresOwner(
    [
      postgresBinaryPath("pg_ctl"),
      "-D",
      dataDir,
      "-w",
      "-t",
      "30",
      "-l",
      logPath,
      "-o",
      pgCtlOptionsForDurability(port, durability),
      "start",
    ],
    { env: { TZ: "UTC" } },
  );
}

function canRecoverDisposableWalPanic(
  dataDir: string,
  logPath: string,
  startResult: RunResult,
): boolean {
  if (!isDisposableTestPgDataDir(dataDir)) {
    return false;
  }
  if (pgCtlServerRunning(dataDir) || hasLivePostmasterPid(dataDir)) {
    return false;
  }
  const combinedLog = `${readLogTailSync(logPath)}\n${startResult.stderr}\n${startResult.stdout}`;
  return hasStartupWalPanic(combinedLog);
}

export function initializeAndStartCluster(input: {
  readonly port: number;
  readonly dataRoot: string;
  readonly dataDir: string;
  readonly durability: PostgresClusterDurability;
  readonly allowWalPanicWipe: boolean;
}): void {
  const { port, dataRoot, dataDir, durability, allowWalPanicWipe } = input;
  ensureRootOwnershipSync(dataRoot);
  ensureInitializedDataDir(dataDir);

  const logPath = path.join(dataRoot, "server.log");
  const start = startClusterOnce(port, dataDir, logPath, durability);
  if (start.exitCode === 0 || serverIsUp(port)) {
    return;
  }

  if (
    allowWalPanicWipe &&
    canRecoverDisposableWalPanic(dataDir, logPath, start)
  ) {
    assertDisposableTestPgDataDir(dataDir);
    rotateLogFileSync(logPath);
    removeDisposableDataDirSync(dataDir);
    ensureRootOwnershipSync(dataRoot);
    runInitdb(dataDir);
    const retry = startClusterOnce(port, dataDir, logPath, durability);
    if (retry.exitCode === 0 || serverIsUp(port)) {
      return;
    }
    throw binariesHint(
      `pg_ctl start failed after WAL panic recovery: ${retry.stderr} (log: ${logPath})`,
    );
  }

  throw binariesHint(`pg_ctl start failed: ${start.stderr} (log: ${logPath})`);
}
