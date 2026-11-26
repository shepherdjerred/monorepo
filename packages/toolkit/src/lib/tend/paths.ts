import { readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_WORKTREE_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export type TendPaths = {
  readonly rootDir: string;
  readonly leasesDir: string;
  readonly stateFile: string;
  readonly eventsFile: string;
  readonly lockFile: string;
};

export function resolveTendPaths(
  options: {
    readonly tendDir?: string | undefined;
    readonly homeDir?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  } = {},
): TendPaths {
  const env = options.env ?? Bun.env;
  const override = options.tendDir ?? env["TOOLKIT_TEND_DIR"];
  const home = options.homeDir ?? env["HOME"] ?? os.homedir();
  const rootDir =
    override !== undefined && override.trim().length > 0
      ? path.resolve(override.trim())
      : path.join(home, ".toolkit", "tend");
  return {
    rootDir,
    leasesDir: path.join(rootDir, "leases"),
    stateFile: path.join(rootDir, "state.json"),
    eventsFile: path.join(rootDir, "events.jsonl"),
    lockFile: path.join(rootDir, "run.lock"),
  };
}

const DURATION_UNITS_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Parse compact duration strings such as `7d`, `24h`, `30m`, `900s`, `500ms`, or `0s`.
 */
export function parseDurationMs(raw: string): number {
  const trimmed = raw.trim();
  const match = /^(\d+)(ms|[smhdw])$/iu.exec(trimmed);
  if (match === null) {
    throw new Error(
      `Invalid duration "${raw}"; expected <integer><ms|s|m|h|d|w> (for example 7d, 24h, 30m, 900s)`,
    );
  }
  const amountText = match[1];
  const unitText = match[2]?.toLowerCase();
  if (amountText === undefined || unitText === undefined) {
    throw new Error(`Invalid duration "${raw}"`);
  }
  const amount = Number(amountText);
  const multiplier = DURATION_UNITS_MS[unitText];
  if (multiplier === undefined || !Number.isSafeInteger(amount)) {
    throw new RangeError(`Duration out of range: "${raw}"`);
  }
  const total = amount * multiplier;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(`Duration out of range: "${raw}"`);
  }
  return total;
}

export function formatDurationCompact(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    return hours > 0 ? `${String(days)}d${String(hours)}h` : `${String(days)}d`;
  }
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0
      ? `${String(hours)}h${String(minutes)}m`
      : `${String(hours)}h`;
  }
  return seconds >= 60
    ? `${String(Math.floor(seconds / 60))}m`
    : `${String(seconds)}s`;
}

/**
 * Pure string path canonicalization across macOS (`/private/tmp` <-> `/tmp`,
 * `/private/var` <-> `/var`), Windows (`\` -> `/`, lowercase drive letter),
 * and POSIX trailing slashes.
 */
export function normalizeHostPath(
  inputPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (platform === "win32") {
    const forward = trimmed.replaceAll("\\", "/");
    const collapsed = forward.replaceAll(/\/+/gu, "/");
    const withLowerDrive = collapsed.replace(
      /^([A-Za-z]):/u,
      (_whole, drive: string) => `${drive.toLowerCase()}:`,
    );
    return withLowerDrive.length > 3
      ? withLowerDrive.replace(/\/+$/u, "")
      : withLowerDrive;
  }
  const normalized = path.posix.normalize(trimmed);
  const stripped =
    normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
  if (platform === "darwin") {
    if (stripped === "/tmp") {
      return "/private/tmp";
    }
    if (stripped.startsWith("/tmp/")) {
      return `/private${stripped}`;
    }
    if (stripped === "/var") {
      return "/private/var";
    }
    if (stripped.startsWith("/var/")) {
      return `/private${stripped}`;
    }
  }
  return stripped;
}

/**
 * Resolve symlinks when the path exists on disk, then normalize for comparison.
 */
export async function canonicalizeExistingPath(
  inputPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  try {
    const resolved = await realpath(inputPath);
    return normalizeHostPath(resolved, platform);
  } catch {
    return normalizeHostPath(inputPath, platform);
  }
}

/**
 * True when `candidateChild` is equal to `parentDir` or nested inside it
 * (after host path normalization).
 */
export function isPathInside(
  candidateChild: string,
  parentDir: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const child = normalizeHostPath(candidateChild, platform);
  const parent = normalizeHostPath(parentDir, platform);
  if (child.length === 0 || parent.length === 0) {
    return false;
  }
  if (child === parent) {
    return true;
  }
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return child.startsWith(prefix);
}

/**
 * True when `targetPath` contains (or equals) any open/protected path `held`
 * (e.g. a live shell or process CWD inside a worktree or artifact directory).
 * Deliberately does NOT treat an ancestor CWD (like `~`, `~/git/monorepo`, or
 * `$TMPDIR`) as protecting all of its sibling/child subdirectories.
 */
export function isPathProtected(
  targetPath: string,
  protectedPaths: Iterable<string>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizedTarget = normalizeHostPath(targetPath, platform);
  if (normalizedTarget.length === 0) {
    return false;
  }
  for (const held of protectedPaths) {
    if (isPathInside(held, normalizedTarget, platform)) {
      return true;
    }
  }
  return false;
}

/**
 * True when `targetPath` is equal to or nested inside an explicit hold prefix
 * (such as a Forum notice path or active directory lease).
 */
export function isUnderProtectedPrefix(
  targetPath: string,
  prefixPaths: Iterable<string>,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizedTarget = normalizeHostPath(targetPath, platform);
  if (normalizedTarget.length === 0) {
    return false;
  }
  for (const prefix of prefixPaths) {
    if (isPathInside(normalizedTarget, prefix, platform)) {
      return true;
    }
  }
  return false;
}

export async function readSortedNames(dirPath: string): Promise<string[]> {
  try {
    const names = await readdir(dirPath);
    return names.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function statDirectoryMtime(
  dirPath: string,
): Promise<number | null> {
  try {
    const info = await stat(dirPath);
    return info.isDirectory() ? info.mtimeMs : null;
  } catch {
    return null;
  }
}

const POSIX_PATH_PATTERN =
  /(?:^|[\s"'`=(])((?:\/Users\/|\/private\/tmp\/|\/private\/var\/|\/tmp\/|\/home\/)[^\s"'`),;<>]+)/gu;
const WINDOWS_PATH_PATTERN = /(?:^|[\s"'`=(])([A-Za-z]:\\[^\s"'`),;<>]+)/gu;

function trimTrailingPathPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && ".:;!?".includes(value[end - 1] ?? "")) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function extractAbsolutePathsFromText(
  text: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(POSIX_PATH_PATTERN)) {
    const raw =
      match[1] === undefined
        ? undefined
        : trimTrailingPathPunctuation(match[1]);
    if (raw !== undefined && raw.length > 1) {
      found.add(normalizeHostPath(raw, platform));
    }
  }
  for (const match of text.matchAll(WINDOWS_PATH_PATTERN)) {
    const raw =
      match[1] === undefined
        ? undefined
        : trimTrailingPathPunctuation(match[1]);
    if (raw !== undefined && raw.length > 3) {
      found.add(normalizeHostPath(raw, platform));
    }
  }
  return [...found];
}
