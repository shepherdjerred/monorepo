import path from "node:path";
import { z } from "zod";
import { formatDurationCompact } from "./paths.ts";
import { processStartsMatch } from "./process-probe.ts";
import type {
  CommandRunner,
  LivenessSnapshot,
  OsProcessEntry,
  TendActionOutcome,
  TendCandidate,
} from "./types.ts";

const TEST_DB_NAME_PATTERN = /^(?:scout|delivery|media|tracker)_(?:test|mig)_/u;
const DB_OWNER_GRACE_MS = 5 * 60 * 1000;
const TEMPLATE_DB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const OwnerPidJsonSchema = z.looseObject({
  pid: z.number().int().positive(),
  processStart: z.string().min(1).optional(),
});

const DbOwnerCommentJsonSchema = z.looseObject({
  host: z.string().min(1),
  pid: z.number().int().positive(),
  processStart: z.string().min(1),
  createdAt: z.number().nonnegative(),
  templateHash: z.string().optional(),
});
export type DbOwnerComment = z.infer<typeof DbOwnerCommentJsonSchema>;

export type SharedPostgresDatabaseRow = {
  readonly name: string;
  readonly comment: string | null;
  readonly connections: number;
  readonly pgVersionMtimeMs?: number | undefined;
};

export type SharedPostgresAdapter = {
  readonly listDatabases: () => Promise<readonly SharedPostgresDatabaseRow[]>;
  readonly dropDatabase: (databaseName: string) => Promise<void>;
};

export type ParsedOwnerPid = {
  readonly pid: number;
  readonly processStart?: string | undefined;
};

export function parseClusterOwnerPidFile(text: string): ParsedOwnerPid | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^\d+$/u.test(trimmed)) {
    const pid = Number(trimmed);
    return Number.isInteger(pid) && pid > 0 ? { pid } : null;
  }
  try {
    const parsed = OwnerPidJsonSchema.safeParse(JSON.parse(trimmed));
    if (!parsed.success) {
      return null;
    }
    return {
      pid: parsed.data.pid,
      ...(parsed.data.processStart === undefined
        ? {}
        : { processStart: parsed.data.processStart }),
    };
  } catch {
    return null;
  }
}

export function parseDatabaseOwnerComment(
  comment: string | null,
): DbOwnerComment | null {
  if (comment === null) {
    return null;
  }
  const prefixes = ["scout-test-owner/v1 ", "monorepo-test-owner/v1 "];
  const matchedPrefix = prefixes.find((prefix) => comment.startsWith(prefix));
  if (matchedPrefix === undefined) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(comment.slice(matchedPrefix.length));
    const parsed = DbOwnerCommentJsonSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isOwnerDeadOnThisHost(
  owner: ParsedOwnerPid,
  processes: ReadonlyMap<number, OsProcessEntry>,
): { readonly dead: boolean; readonly reason: string } {
  const proc = processes.get(owner.pid);
  if (proc === undefined) {
    return { dead: true, reason: `owner pid ${String(owner.pid)} exited` };
  }
  if (
    owner.processStart !== undefined &&
    !processStartsMatch(proc.processStart, owner.processStart)
  ) {
    return {
      dead: true,
      reason: `owner pid ${String(owner.pid)} reused (started ${proc.processStart}, expected ${owner.processStart})`,
    };
  }
  return { dead: false, reason: `owner pid ${String(owner.pid)} still alive` };
}

const PsqlDbRowSchema = z.array(
  z.looseObject({
    name: z.string(),
    comment: z.string().nullable(),
    connections: z.number().int().nonnegative(),
    mtimeEpoch: z.number().nullable().optional(),
  }),
);

export function createPsqlSharedAdapter(
  port: number,
  runner: CommandRunner,
): SharedPostgresAdapter {
  const querySql =
    "SELECT coalesce(json_agg(json_build_object(" +
    "'name', d.datname, " +
    "'comment', shobj_description(d.oid, 'pg_database'), " +
    "'connections', (SELECT count(*)::int FROM pg_stat_activity a WHERE a.datid = d.oid), " +
    "'mtimeEpoch', extract(epoch FROM (pg_stat_file('base/' || d.oid::text || '/PG_VERSION', true)).modification)" +
    ")), '[]') FROM pg_database d WHERE d.datname NOT IN ('postgres', 'template0', 'template1')";

  async function runPsql(sql: string): Promise<string> {
    const urls = [
      `postgres://scout@127.0.0.1:${String(port)}/postgres`,
      `postgres://postgres@127.0.0.1:${String(port)}/postgres`,
    ];
    for (const url of urls) {
      const res = await runner(
        ["psql", "--no-psqlrc", "-X", "-A", "-t", "--dbname", url, "-c", sql],
        { timeoutMs: 4000 },
      );
      if (res.exitCode === 0) {
        return res.stdout.trim();
      }
    }
    const fallback = await runner(
      [
        "psql",
        "--no-psqlrc",
        "-X",
        "-A",
        "-t",
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-d",
        "postgres",
        "-c",
        sql,
      ],
      { timeoutMs: 4000 },
    );
    if (fallback.exitCode !== 0) {
      throw new Error(fallback.stderr.trim() || "psql query failed");
    }
    return fallback.stdout.trim();
  }

  return {
    async listDatabases(): Promise<readonly SharedPostgresDatabaseRow[]> {
      const raw = await runPsql(querySql);
      if (raw.length === 0) {
        return [];
      }
      const parsed = PsqlDbRowSchema.parse(JSON.parse(raw));
      return parsed.map((row) => ({
        name: row.name,
        comment: row.comment,
        connections: row.connections,
        ...(row.mtimeEpoch === null || row.mtimeEpoch === undefined
          ? {}
          : { pgVersionMtimeMs: row.mtimeEpoch * 1000 }),
      }));
    },
    async dropDatabase(databaseName: string): Promise<void> {
      if (!/^[\w-]+$/u.test(databaseName)) {
        throw new Error(`Refusing unsafe database identifier: ${databaseName}`);
      }
      if (databaseName.includes("_template_")) {
        await runPsql(
          `ALTER DATABASE "${databaseName}" WITH IS_TEMPLATE = FALSE`,
        );
      }
      await runPsql(`DROP DATABASE "${databaseName}"`);
    },
  };
}

function evaluateOwnedTestDatabase(
  row: SharedPostgresDatabaseRow,
  liveness: LivenessSnapshot,
  nowMs: number,
): { readonly drop: boolean; readonly reason: string; readonly ageMs: number } {
  const owner = parseDatabaseOwnerComment(row.comment);
  if (owner === null) {
    return { drop: false, reason: "unowned database", ageMs: 0 };
  }
  if (!liveness.localHostAliases.has(owner.host.toLowerCase())) {
    return { drop: false, reason: "foreign host owner", ageMs: 0 };
  }
  const ageMs = Math.max(0, nowMs - owner.createdAt);
  if (ageMs < DB_OWNER_GRACE_MS) {
    return { drop: false, reason: "within grace window", ageMs };
  }
  const ownerCheck = isOwnerDeadOnThisHost(owner, liveness.processes);
  return { drop: ownerCheck.dead, reason: ownerCheck.reason, ageMs };
}

function evaluateTemplateDatabase(
  row: SharedPostgresDatabaseRow,
  liveness: LivenessSnapshot,
  nowMs: number,
): { readonly drop: boolean; readonly reason: string; readonly ageMs: number } {
  const owner = parseDatabaseOwnerComment(row.comment);
  const createdMs = owner?.createdAt ?? row.pgVersionMtimeMs;
  if (createdMs === undefined) {
    return { drop: false, reason: "unknown template age", ageMs: 0 };
  }
  if (
    owner !== null &&
    !liveness.localHostAliases.has(owner.host.toLowerCase())
  ) {
    return { drop: false, reason: "foreign host template", ageMs: 0 };
  }
  const ageMs = Math.max(0, nowMs - createdMs);
  return ageMs >= TEMPLATE_DB_MAX_AGE_MS
    ? {
        drop: true,
        reason: `unused template older than 7d (${formatDurationCompact(ageMs)}, 0 connections)`,
        ageMs,
      }
    : { drop: false, reason: "recent template", ageMs };
}

export function evaluateSharedDatabaseRow(options: {
  readonly row: SharedPostgresDatabaseRow;
  readonly liveness: LivenessSnapshot;
  readonly nowMs: number;
}): {
  readonly drop: boolean;
  readonly reason: string;
  readonly ageMs: number;
} {
  const { row, liveness, nowMs } = options;
  if (row.connections > 0) {
    return { drop: false, reason: "active connections", ageMs: 0 };
  }
  if (TEST_DB_NAME_PATTERN.test(row.name)) {
    return evaluateOwnedTestDatabase(row, liveness, nowMs);
  }
  return row.name.includes("_template_")
    ? evaluateTemplateDatabase(row, liveness, nowMs)
    : { drop: false, reason: "not eligible", ageMs: 0 };
}

export async function sweepSharedPostgresDatabases(options: {
  readonly adapter: SharedPostgresAdapter;
  readonly sharedPort: number;
  readonly liveness: LivenessSnapshot;
  readonly apply: boolean;
  readonly nowMs: number;
  readonly candidates: TendCandidate[];
  readonly actions: TendActionOutcome[];
  readonly warnings: string[];
}): Promise<number> {
  try {
    const dbRows = await options.adapter.listDatabases();
    for (const row of dbRows) {
      const verdict = evaluateSharedDatabaseRow({
        row,
        liveness: options.liveness,
        nowMs: options.nowMs,
      });
      if (!verdict.drop) {
        continue;
      }
      const candidate: TendCandidate = {
        id: `pg-db:${String(options.sharedPort)}:${row.name}`,
        surface: "postgres",
        kind: row.name.includes("_template_")
          ? "template-database"
          : "test-database",
        target: `127.0.0.1:${String(options.sharedPort)}/${row.name}`,
        reason: verdict.reason,
        ageSeconds: Math.floor(verdict.ageMs / 1000),
      };
      options.candidates.push(candidate);
      if (!options.apply) {
        options.actions.push({ candidate, status: "planned" });
        continue;
      }
      try {
        await options.adapter.dropDatabase(row.name);
        options.actions.push({ candidate, status: "removed" });
      } catch (error: unknown) {
        options.actions.push({
          candidate,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return dbRows.length;
  } catch (error: unknown) {
    options.warnings.push(
      `Shared Postgres inspection on 127.0.0.1:${String(options.sharedPort)} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

export function isPostgresCommandName(proc: OsProcessEntry): boolean {
  const argv0 = proc.args.trim().split(/\s+/u)[0] ?? proc.command;
  const lower = argv0.toLowerCase();
  return (
    argv0 === "postgres" ||
    argv0 === "postgres:" ||
    argv0.endsWith("/postgres") ||
    lower === "postgres.exe" ||
    lower.endsWith(String.raw`\postgres.exe`) ||
    lower.endsWith("/postgres.exe")
  );
}

export function isPostgresServerProcess(
  proc: OsProcessEntry,
  verifiedPostmasterPid: number | undefined,
): boolean {
  return (
    (verifiedPostmasterPid !== undefined &&
      (proc.pid === verifiedPostmasterPid ||
        proc.ppid === verifiedPostmasterPid)) ||
    isPostgresCommandName(proc)
  );
}

export type PostmasterInfo = {
  readonly dataDir: string;
  readonly pid: number;
  readonly port?: number | undefined;
};

export async function readPostmasterInfo(
  clusterDir: string,
): Promise<PostmasterInfo | null> {
  const candidateDataDirs = [path.join(clusterDir, "data"), clusterDir];
  for (const dataDir of candidateDataDirs) {
    const pidFile = Bun.file(path.join(dataDir, "postmaster.pid"));
    if (!(await pidFile.exists())) {
      continue;
    }
    try {
      const content = await pidFile.text();
      const lines = content.split(/\r?\n/u);
      const pid = Number(lines[0]?.trim() ?? "");
      const portRaw = Number(lines[3]?.trim() ?? "");
      if (Number.isInteger(pid) && pid > 0) {
        return {
          dataDir,
          pid,
          ...(Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65_535
            ? { port: portRaw }
            : {}),
        };
      }
    } catch {
      // Ignore unreadable postmaster.pid.
    }
  }
  return null;
}

export function resolveVerifiedPostmasterPid(
  postmaster: PostmasterInfo | null,
  liveness: LivenessSnapshot,
): number | undefined {
  if (postmaster === null) {
    return undefined;
  }
  const live = liveness.processes.get(postmaster.pid);
  return live !== undefined && isPostgresCommandName(live)
    ? postmaster.pid
    : undefined;
}
