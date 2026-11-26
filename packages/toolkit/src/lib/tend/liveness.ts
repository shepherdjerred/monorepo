import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { trackerClient } from "#lib/tracker/client.ts";
import {
  canonicalizeExistingPath,
  extractAbsolutePathsFromText,
  normalizeHostPath,
} from "./paths.ts";
import {
  collectDescendantPids,
  defaultCommandRunner,
  isProcessAliveByKillZero,
  resolveHostAliases,
  snapshotOsProcesses,
} from "./process-probe.ts";
import type {
  CommandRunner,
  ForumNoticeSummary,
  HcTerminalEntry,
  LivenessSnapshot,
  OsProcessEntry,
  TendSurface,
} from "./types.ts";

const HcTerminalRawSchema = z.looseObject({
  address: z.string(),
  state: z.string().optional(),
  cwd: z.string().optional(),
  agent: z.string().optional(),
  pid: z.number().int().positive().optional(),
  foreground: z
    .looseObject({
      cwd: z.string().optional(),
      pid: z.number().int().positive().optional(),
    })
    .optional(),
});

const HcLsOutputSchema = z.looseObject({
  terminals: z.array(HcTerminalRawSchema).optional(),
});

const HerdrActiveFileSchema = z.looseObject({
  pid: z.number().int().positive().optional(),
  path: z.string().nullable().optional(),
});

export const RawForumNoticeSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  body: z.string().optional(),
  scopes: z.array(z.string()),
  state: z.string().optional(),
  expired: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
  creator: z
    .looseObject({
      metadata: z
        .looseObject({
          cwd: z.string().optional(),
          worktree: z.string().optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});
export type RawForumNotice = z.infer<typeof RawForumNoticeSchema>;
export type ForumNoticesFetcher = () => Promise<readonly RawForumNotice[]>;

function isLocalHcAddress(
  address: string,
  localAliases: ReadonlySet<string>,
): boolean {
  const slashIndex = address.indexOf("/");
  return (
    slashIndex === -1 ||
    localAliases.has(address.slice(0, slashIndex).toLowerCase())
  );
}

async function toHcTerminalEntry(
  row: z.infer<typeof HcTerminalRawSchema>,
  platform: NodeJS.Platform,
  localAliases: ReadonlySet<string>,
): Promise<HcTerminalEntry | null> {
  if (
    row.state !== undefined &&
    row.state !== "live" &&
    row.state !== "running"
  ) {
    return null;
  }
  if (!isLocalHcAddress(row.address, localAliases)) {
    return null;
  }
  const cwd =
    row.cwd === undefined
      ? ""
      : await canonicalizeExistingPath(row.cwd, platform);
  const foregroundCwd =
    row.foreground?.cwd === undefined
      ? undefined
      : await canonicalizeExistingPath(row.foreground.cwd, platform);
  const pid = row.foreground?.pid ?? row.pid;
  return {
    address: row.address,
    cwd,
    ...(foregroundCwd !== undefined && foregroundCwd.length > 0
      ? { foregroundCwd }
      : {}),
    ...(pid === undefined ? {} : { pid }),
    ...(row.agent === undefined ? {} : { agent: row.agent }),
  };
}

export async function collectHcTerminals(options: {
  readonly runner: CommandRunner;
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
  readonly localAliases: ReadonlySet<string>;
}): Promise<{
  readonly available: boolean;
  readonly terminals: HcTerminalEntry[];
}> {
  let hcRes = await options.runner(["hc", "ls", "--json"], { timeoutMs: 3000 });
  if (hcRes.exitCode === 127 && options.platform !== "win32") {
    const fallbackHc = path.join(options.homeDir, ".local", "bin", "hc");
    if (await Bun.file(fallbackHc).exists()) {
      hcRes = await options.runner([fallbackHc, "ls", "--json"], {
        timeoutMs: 3000,
      });
    }
  }
  if (hcRes.exitCode !== 0 || hcRes.stdout.trim().length === 0) {
    return { available: false, terminals: [] };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(hcRes.stdout);
  } catch {
    return { available: false, terminals: [] };
  }
  const parsed = HcLsOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { available: false, terminals: [] };
  }
  const terminals: HcTerminalEntry[] = [];
  for (const row of parsed.data.terminals ?? []) {
    const entry = await toHcTerminalEntry(
      row,
      options.platform,
      options.localAliases,
    );
    if (entry !== null) {
      terminals.push(entry);
    }
  }
  return { available: true, terminals };
}

async function collectHerdrActiveWorktrees(options: {
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
  readonly processes: ReadonlyMap<number, OsProcessEntry>;
}): Promise<Set<string>> {
  const activeDir = path.join(
    options.homeDir,
    ".local",
    "state",
    "herdr-worktree",
    "active",
  );
  let names: string[];
  try {
    names = await readdir(activeDir);
  } catch {
    return new Set();
  }
  const paths = new Set<string>();
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const text = await Bun.file(path.join(activeDir, name)).text();
      const parsed = HerdrActiveFileSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        continue;
      }
      const { pid, path: rawPath } = parsed.data;
      const pidLive =
        pid === undefined ||
        options.processes.has(pid) ||
        isProcessAliveByKillZero(pid);
      if (pidLive && typeof rawPath === "string" && rawPath.trim().length > 0) {
        paths.add(await canonicalizeExistingPath(rawPath, options.platform));
      }
    } catch {
      // Ignore unreadable active run file.
    }
  }
  return paths;
}

export async function defaultFetchForumNotices(): Promise<
  readonly RawForumNotice[]
> {
  const config = await loadToolkitConfig();
  const url = await config.value("trackerUrl");
  const response = await trackerClient(url, 3000).forum.list.query({
    kind: "notice",
    state: "active",
    limit: 100,
  });
  return response.items.map((item) => RawForumNoticeSchema.parse(item));
}

function isNoticeActiveForHost(
  notice: RawForumNotice,
  localAliases: ReadonlySet<string>,
  nowMs: number,
): boolean {
  if (
    notice.expired === true ||
    (notice.state !== undefined && notice.state !== "open")
  ) {
    return false;
  }
  if (notice.expiresAt !== null && notice.expiresAt !== undefined) {
    const expiresMs = Date.parse(notice.expiresAt);
    if (!Number.isNaN(expiresMs) && expiresMs <= nowMs) {
      return false;
    }
  }
  return notice.scopes.some((scope) => {
    const lower = scope.toLowerCase();
    return (
      lower.startsWith("host/") && localAliases.has(lower.slice("host/".length))
    );
  });
}

function extractNoticePaths(
  notice: RawForumNotice,
  platform: NodeJS.Platform,
): string[] {
  const extracted = new Set<string>();
  if (notice.body !== undefined) {
    for (const p of extractAbsolutePathsFromText(notice.body, platform)) {
      extracted.add(p);
    }
  }
  const meta = notice.creator?.metadata;
  for (const candidate of [meta?.cwd, meta?.worktree]) {
    if (candidate !== undefined && candidate.trim().length > 0) {
      extracted.add(normalizeHostPath(candidate, platform));
    }
  }
  return [...extracted];
}

function evaluateHostNotices(options: {
  readonly rawNotices: readonly RawForumNotice[];
  readonly localAliases: ReadonlySet<string>;
  readonly platform: NodeJS.Platform;
  readonly nowMs: number;
}): {
  readonly summaries: ForumNoticeSummary[];
  readonly protectedPaths: Set<string>;
  readonly holdSurfaces: Map<TendSurface, string>;
} {
  const summaries: ForumNoticeSummary[] = [];
  const protectedPaths = new Set<string>();
  const holdSurfaces = new Map<TendSurface, string>();
  for (const notice of options.rawNotices) {
    if (!isNoticeActiveForHost(notice, options.localAliases, options.nowMs)) {
      continue;
    }
    const noticePaths = extractNoticePaths(notice, options.platform);
    for (const p of noticePaths) {
      protectedPaths.add(p);
    }
    const lowerScopes = new Set(notice.scopes.map((s) => s.toLowerCase()));
    const holdsDatabasesOrTesting =
      lowerScopes.has("databases") || lowerScopes.has("testing");
    if (holdsDatabasesOrTesting) {
      const holdReason = `held by active host Forum notice ${notice.id} (${notice.title})`;
      if (!holdSurfaces.has("postgres")) {
        holdSurfaces.set("postgres", holdReason);
      }
      if (!holdSurfaces.has("processes")) {
        holdSurfaces.set("processes", holdReason);
      }
    }
    summaries.push({
      id: notice.id,
      title: notice.title,
      scopes: notice.scopes,
      protectedPaths: noticePaths,
      holdsDatabasesOrTesting,
    });
  }
  return { summaries, protectedPaths, holdSurfaces };
}

async function resolveForumNoticeState(options: {
  readonly fetchForumNotices: ForumNoticesFetcher | undefined;
  readonly offline: boolean;
  readonly localAliases: ReadonlySet<string>;
  readonly platform: NodeJS.Platform;
  readonly nowMs: number;
  readonly warnings: string[];
}): Promise<{
  readonly forumAvailable: boolean;
  readonly forumNotices: ForumNoticeSummary[];
  readonly forumNoticePaths: Set<string>;
  readonly holdSurfaces: Map<TendSurface, string>;
}> {
  const holdSurfaces = new Map<TendSurface, string>();
  if (options.offline && options.fetchForumNotices === undefined) {
    options.warnings.push(
      "Forum notice query skipped (--offline); proceeding without notice holds.",
    );
    return {
      forumAvailable: false,
      forumNotices: [],
      forumNoticePaths: new Set(),
      holdSurfaces,
    };
  }
  const fetcher = options.fetchForumNotices ?? defaultFetchForumNotices;
  try {
    const evaluated = evaluateHostNotices({
      rawNotices: await fetcher(),
      localAliases: options.localAliases,
      platform: options.platform,
      nowMs: options.nowMs,
    });
    return {
      forumAvailable: true,
      forumNotices: evaluated.summaries,
      forumNoticePaths: evaluated.protectedPaths,
      holdSurfaces: evaluated.holdSurfaces,
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    if (options.offline) {
      options.warnings.push(
        `Forum notice query failed (${detail}); proceeding due to --offline.`,
      );
    } else {
      const holdMsg =
        "Forum notice query unavailable; holding notice-sensitive sweeps (pass --offline to override)";
      options.warnings.push(`${holdMsg}: ${detail}`);
      holdSurfaces.set("worktrees", holdMsg);
      holdSurfaces.set("postgres", holdMsg);
      holdSurfaces.set("processes", holdMsg);
    }
    return {
      forumAvailable: false,
      forumNotices: [],
      forumNoticePaths: new Set(),
      holdSurfaces,
    };
  }
}

function mergeProtectedPaths(
  terminals: readonly HcTerminalEntry[],
  sets: readonly ReadonlySet<string>[],
): Set<string> {
  const merged = new Set<string>();
  for (const term of terminals) {
    if (term.cwd.length > 0) {
      merged.add(term.cwd);
    }
    if (term.foregroundCwd !== undefined && term.foregroundCwd.length > 0) {
      merged.add(term.foregroundCwd);
    }
  }
  for (const group of sets) {
    for (const p of group) {
      merged.add(p);
    }
  }
  return merged;
}

export type CollectLivenessOptions = {
  readonly runner?: CommandRunner | undefined;
  readonly fetchForumNotices?: ForumNoticesFetcher | undefined;
  readonly offline?: boolean | undefined;
  readonly homeDir?: string | undefined;
  readonly hostname?: string | undefined;
  readonly hostAliases?: readonly string[] | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly nowMs?: number | undefined;
  readonly processesOverride?: ReadonlyMap<number, OsProcessEntry> | undefined;
};

export async function collectLivenessSnapshot(
  options: CollectLivenessOptions = {},
): Promise<LivenessSnapshot> {
  const runner = options.runner ?? defaultCommandRunner;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? Bun.env["HOME"] ?? os.homedir();
  const rawHostname = options.hostname ?? os.hostname();
  const nowMs = options.nowMs ?? Date.now();
  const warnings: string[] = [];
  const { primary: localHost, aliases: localHostAliases } =
    await resolveHostAliases({
      hostname: rawHostname,
      extraAliases: options.hostAliases,
      runner,
    });
  const [hcResult, processes] = await Promise.all([
    collectHcTerminals({
      runner,
      homeDir,
      platform,
      localAliases: localHostAliases,
    }),
    options.processesOverride === undefined
      ? snapshotOsProcesses({ runner, platform, nowMs })
      : Promise.resolve(new Map(options.processesOverride)),
  ]);
  const herdrActivePaths = await collectHerdrActiveWorktrees({
    homeDir,
    platform,
    processes,
  });
  const processCwds = new Set<string>();
  for (const proc of processes.values()) {
    if (proc.cwd !== undefined && proc.cwd.length > 0) {
      processCwds.add(proc.cwd);
    }
  }
  const forumState = await resolveForumNoticeState({
    fetchForumNotices: options.fetchForumNotices,
    offline: options.offline === true,
    localAliases: localHostAliases,
    platform,
    nowMs,
    warnings,
  });
  const protectedPaths = mergeProtectedPaths(hcResult.terminals, [
    processCwds,
    herdrActivePaths,
    forumState.forumNoticePaths,
  ]);
  const terminalRootPids: number[] = [];
  for (const term of hcResult.terminals) {
    if (term.pid !== undefined) {
      terminalRootPids.push(term.pid);
    }
  }
  return {
    capturedAt: new Date(nowMs).toISOString(),
    platform,
    localHost,
    localHostAliases,
    hcAvailable: hcResult.available,
    hcTerminals: hcResult.terminals,
    protectedPaths,
    processCwds,
    herdrActivePaths,
    forumNoticePaths: forumState.forumNoticePaths,
    forumNotices: forumState.forumNotices,
    forumAvailable: forumState.forumAvailable,
    holdSurfaces: forumState.holdSurfaces,
    warnings,
    processes,
    liveTerminalRelatedPids: collectDescendantPids(terminalRootPids, processes),
  };
}
