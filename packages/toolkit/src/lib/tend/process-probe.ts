import { createConnection } from "node:net";
import { z } from "zod";
import { normalizeHostPath } from "./paths.ts";
import type {
  CommandExecOptions,
  CommandExecResult,
  CommandRunner,
  OsProcessEntry,
  TcpPortProbe,
} from "./types.ts";

export function normalizeProcessStart(value: string): string {
  return value.trim().replaceAll(/\s+/gu, " ");
}

export function processStartsMatch(left: string, right: string): boolean {
  const a = normalizeProcessStart(left);
  const b = normalizeProcessStart(right);
  return a.length > 0 && a === b;
}

const LSTART_PATTERN =
  /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/u;
const LSTART_MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * Epoch milliseconds for a `ps -o lstart=` value taken with `TZ=UTC LC_ALL=C`
 * (`Thu Nov 20 10:11:12 2026`), the form `OsProcessEntry.processStart` has on
 * POSIX hosts. `null` for anything else.
 */
export function parseProcessStartMs(value: string): number | null {
  const match = LSTART_PATTERN.exec(normalizeProcessStart(value));
  if (match === null) {
    return null;
  }
  const month = LSTART_MONTHS.indexOf((match[1] ?? "").toLowerCase());
  if (month === -1) {
    return null;
  }
  const [day, hour, minute, second, year] = match.slice(2).map(Number);
  const epochMs = Date.UTC(
    year ?? Number.NaN,
    month,
    day ?? Number.NaN,
    hour ?? Number.NaN,
    minute ?? Number.NaN,
    second ?? Number.NaN,
  );
  return Number.isFinite(epochMs) ? epochMs : null;
}

function buildSanitizedChildEnv(
  overrides: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value === "string" && key !== "OP_SERVICE_ACCOUNT_TOKEN") {
      entries.set(key, value);
    }
  }
  if (overrides !== undefined) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        entries.delete(key);
      } else {
        entries.set(key, value);
      }
    }
  }
  return Object.fromEntries(entries);
}

export const defaultCommandRunner: CommandRunner = async (
  argv: readonly string[],
  options: CommandExecOptions = {},
): Promise<CommandExecResult> => {
  const executable = argv[0];
  if (executable === undefined || executable.length === 0) {
    return { exitCode: 127, stdout: "", stderr: "empty command" };
  }
  const mergedEnv = buildSanitizedChildEnv(options.env);
  try {
    const hasTimeout = options.timeoutMs !== undefined && options.timeoutMs > 0;
    const signal = hasTimeout
      ? AbortSignal.timeout(options.timeoutMs)
      : undefined;
    const child = Bun.spawn([...argv], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: mergedEnv,
      ...(signal === undefined ? {} : { signal }),
      stdin:
        options.stdin === undefined
          ? "ignore"
          : new TextEncoder().encode(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const timedOut = signal?.aborted === true;
    return {
      exitCode: timedOut && exitCode === 0 ? 124 : exitCode,
      stdout,
      stderr,
      ...(timedOut ? { timedOut: true } : {}),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 127, stdout: "", stderr: message };
  }
};

export const defaultTcpPortProbe: TcpPortProbe = async (
  host: string,
  port: number,
): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (reachable: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(500);
    socket.once("connect", () => {
      finish(true);
    });
    socket.once("timeout", () => {
      finish(false);
    });
    socket.once("error", () => {
      finish(false);
    });
  });

/**
 * Parse POSIX `ps` `etime` (`[[dd-]hh:]mm:ss`) into elapsed seconds.
 */
export function parseEtimeSeconds(raw: string): number {
  const trimmed = raw.trim();
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/u.exec(trimmed);
  if (match === null) {
    return 0;
  }
  const days = match[1] === undefined ? 0 : Number(match[1]);
  const hours = match[2] === undefined ? 0 : Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  const seconds = Number(match[4] ?? "0");
  return days * 86_400 + hours * 3600 + minutes * 60 + seconds;
}

const POSIX_PS_LINE =
  /^\s*(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+((?:\d+-)?(?:\d+:)?\d+:\d+)\s+(\S+)(?:\s+(\S.*))?$/u;

export function parsePosixPsOutput(
  stdout: string,
  cwdsByPid: ReadonlyMap<number, string> = new Map(),
): Map<number, OsProcessEntry> {
  const result = new Map<number, OsProcessEntry>();
  for (const line of stdout.split("\n")) {
    const match = POSIX_PS_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const processStart = match[3]?.trim() ?? "";
    const elapsedSeconds = parseEtimeSeconds(match[4] ?? "");
    const commToken = match[5] ?? "";
    const restArgs = match[6]?.trim() ?? "";
    const fullArgs = restArgs.length > 0 ? restArgs : commToken;
    if (!Number.isInteger(pid) || pid <= 0 || processStart.length === 0) {
      continue;
    }
    const cwd = cwdsByPid.get(pid);
    result.set(pid, {
      pid,
      ppid,
      processStart,
      elapsedSeconds,
      command: commToken,
      args: fullArgs,
      ...(cwd === undefined ? {} : { cwd }),
    });
  }
  return result;
}

export function parseLsofCwdOutput(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
): Map<number, string> {
  const cwds = new Map<number, string>();
  let currentPid: number | undefined;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("p")) {
      const parsed = Number(line.slice(1));
      currentPid = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
      continue;
    }
    if (currentPid !== undefined && line.startsWith("n")) {
      const normalized = normalizeHostPath(line.slice(1), platform);
      if (normalized !== "/" && normalized.length > 0) {
        cwds.set(currentPid, normalized);
      }
    }
  }
  return cwds;
}

const WinProcessRowSchema = z.looseObject({
  ProcessId: z.number().int().nonnegative(),
  ParentProcessId: z.number().int().nonnegative().optional(),
  CreationDate: z.string().nullable().optional(),
  Name: z.string().nullable().optional(),
  CommandLine: z.string().nullable().optional(),
});

const WinProcessPayloadSchema = z.union([
  WinProcessRowSchema,
  z.array(WinProcessRowSchema),
]);

function parseWinCreationMs(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.length === 0) {
    return null;
  }
  const msJsonMatch = /\/Date\((\d+)\)\//u.exec(raw);
  if (msJsonMatch?.[1] !== undefined) {
    return Number(msJsonMatch[1]);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseWindowsCimOutput(
  stdout: string,
  nowMs: number = Date.now(),
): Map<number, OsProcessEntry> {
  const result = new Map<number, OsProcessEntry>();
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return result;
  }
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(trimmed);
  } catch {
    return result;
  }
  const parsed = WinProcessPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    return result;
  }
  const rows = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  for (const row of rows) {
    if (row.ProcessId <= 0) {
      continue;
    }
    const createdMs = parseWinCreationMs(row.CreationDate);
    const processStart =
      row.CreationDate !== null &&
      row.CreationDate !== undefined &&
      row.CreationDate.length > 0
        ? row.CreationDate
        : `pid-${String(row.ProcessId)}`;
    const elapsedSeconds =
      createdMs === null
        ? 0
        : Math.max(0, Math.floor((nowMs - createdMs) / 1000));
    const command = row.Name ?? "unknown";
    const args = row.CommandLine ?? command;
    result.set(row.ProcessId, {
      pid: row.ProcessId,
      ppid: row.ParentProcessId ?? 0,
      processStart,
      elapsedSeconds,
      command,
      args,
    });
  }
  return result;
}

export async function snapshotOsProcesses(options: {
  readonly runner?: CommandRunner | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly nowMs?: number | undefined;
}): Promise<Map<number, OsProcessEntry>> {
  const runner = options.runner ?? defaultCommandRunner;
  const platform = options.platform ?? process.platform;
  const nowMs = options.nowMs ?? Date.now();

  if (platform === "win32") {
    const cim = await runner(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { timeoutMs: 8000 },
    );
    return cim.exitCode === 0
      ? parseWindowsCimOutput(cim.stdout, nowMs)
      : new Map();
  }

  const [psResult, lsofResult] = await Promise.all([
    runner(["ps", "-ww", "-eo", "pid=,ppid=,lstart=,etime=,comm=,args="], {
      env: { TZ: "UTC", LC_ALL: "C" },
      timeoutMs: 5000,
    }),
    runner(["lsof", "-w", "-a", "-d", "cwd", "-Fn"], {
      timeoutMs: 5000,
    }),
  ]);
  const cwds =
    lsofResult.exitCode === 0 || lsofResult.stdout.length > 0
      ? parseLsofCwdOutput(lsofResult.stdout, platform)
      : new Map<number, string>();
  return psResult.exitCode === 0
    ? parsePosixPsOutput(psResult.stdout, cwds)
    : new Map();
}

export async function readSingleProcessStart(
  pid: number,
  options: {
    readonly runner?: CommandRunner | undefined;
    readonly platform?: NodeJS.Platform | undefined;
  } = {},
): Promise<string | undefined> {
  const runner = options.runner ?? defaultCommandRunner;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const res = await runner(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${String(pid)}").CreationDate`,
      ],
      { timeoutMs: 4000 },
    );
    const trimmed = res.stdout.trim();
    return res.exitCode === 0 && trimmed.length > 0 ? trimmed : undefined;
  }
  const res = await runner(["ps", "-o", "lstart=", "-p", String(pid)], {
    env: { TZ: "UTC", LC_ALL: "C" },
    timeoutMs: 3000,
  });
  const trimmed = res.stdout.trim();
  return res.exitCode === 0 && trimmed.length > 0 ? trimmed : undefined;
}

export function isProcessAliveByKillZero(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const ErrnoSchema = z.looseObject({ code: z.string() });
    const parsed = ErrnoSchema.safeParse(error);
    return parsed.success && parsed.data.code === "EPERM";
  }
}

const TailscaleSelfSchema = z.looseObject({
  Self: z
    .looseObject({
      HostName: z.string().optional(),
      DNSName: z.string().optional(),
    })
    .optional(),
});

function deriveShortHostname(rawHost: string): string {
  const firstLabel = rawHost.trim().split(".")[0] ?? rawHost.trim();
  return firstLabel
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

function addNonEmptyLower(set: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed !== undefined && trimmed.length > 0) {
    set.add(trimmed);
  }
}

function parseTailscaleAliases(stdout: string): {
  readonly dnsFirst?: string | undefined;
  readonly hostName?: string | undefined;
} {
  try {
    const parsed = TailscaleSelfSchema.safeParse(JSON.parse(stdout));
    return parsed.success
      ? {
          dnsFirst: parsed.data.Self?.DNSName?.split(".")[0]?.toLowerCase(),
          hostName: parsed.data.Self?.HostName?.toLowerCase(),
        }
      : {};
  } catch {
    return {};
  }
}

export async function resolveHostAliases(options: {
  readonly hostname: string;
  readonly extraAliases?: readonly string[] | undefined;
  readonly runner: CommandRunner;
}): Promise<{ readonly primary: string; readonly aliases: Set<string> }> {
  const aliases = new Set<string>();
  const shortFromOs = deriveShortHostname(options.hostname);
  addNonEmptyLower(aliases, shortFromOs);
  addNonEmptyLower(aliases, options.hostname);
  addNonEmptyLower(aliases, Bun.env["BRIM_SYNC_MACHINE_ID"]);
  for (const extra of options.extraAliases ?? []) {
    addNonEmptyLower(aliases, extra);
  }
  let primary = shortFromOs.length > 0 ? shortFromOs : options.hostname;
  const tsStatus = await options.runner(["tailscale", "status", "--json"], {
    timeoutMs: 1500,
  });
  if (tsStatus.exitCode === 0 && tsStatus.stdout.trim().length > 0) {
    const ts = parseTailscaleAliases(tsStatus.stdout);
    if (ts.dnsFirst !== undefined && ts.dnsFirst.length > 0) {
      aliases.add(ts.dnsFirst);
      primary = ts.dnsFirst;
    }
    addNonEmptyLower(aliases, ts.hostName);
  }
  return { primary, aliases };
}

export function collectDescendantPids(
  roots: Iterable<number>,
  processes: ReadonlyMap<number, OsProcessEntry>,
): Set<number> {
  const childrenByPpid = new Map<number, number[]>();
  for (const proc of processes.values()) {
    const siblings = childrenByPpid.get(proc.ppid) ?? [];
    siblings.push(proc.pid);
    childrenByPpid.set(proc.ppid, siblings);
  }
  const visited = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid === undefined || visited.has(pid)) {
      continue;
    }
    visited.add(pid);
    for (const child of childrenByPpid.get(pid) ?? []) {
      queue.push(child);
    }
  }
  return visited;
}
