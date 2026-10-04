import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { ActorRemoveResponseSchema } from "#protocol/bridge.ts";
import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import { PLAYTEST_CHILD_ENTRY, RUNS_DIR } from "#protocol/paths.ts";
import {
  type PlaytestReport,
  PlaytestReportSchema,
  type PlaytestRunRequest,
  type PlaytestRunResponse,
  type ScenarioMeta,
  ScenarioMetaSchema,
} from "#protocol/playtest.ts";
import type { SandboxProvider } from "#sandbox/provider.ts";
import type { SandboxRecord } from "#sandbox/record.ts";
import type { Target } from "#src/target.ts";

/** Grace beyond a scenario's own timeout for cleanup and evidence. */
const CHILD_GRACE_MS = 90_000;
const DESCRIBE_TIMEOUT_MS = 30_000;
const STDERR_TAIL = 2000;

export type RunnerContext = {
  provider: SandboxProvider;
  target: (id: string) => Promise<Target>;
  repoRoot: string;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  runsDir?: string;
};

/** `pt-YYYYMMDD-HHMMSS-xxxx`, sortable by start time. */
export function newRunId(now: Date): string {
  const stamp = now
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace("T", "-")
    .slice(0, 15);
  return `pt-${stamp}-${randomBytes(2).toString("hex")}`;
}

type ChildResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
};

async function runChild(
  repoRoot: string,
  args: string[],
  timeoutMs: number,
): Promise<ChildResult> {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      path.join(repoRoot, PLAYTEST_CHILD_ENTRY),
      ...args,
    ],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr, killed };
}

async function describe(repoRoot: string, file: string): Promise<ScenarioMeta> {
  const result = await runChild(
    repoRoot,
    ["describe", file],
    DESCRIBE_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new Error(
      `Could not load ${file}:\n${result.stderr.slice(-STDERR_TAIL) || result.stdout.slice(-STDERR_TAIL)}`,
    );
  }
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  return ScenarioMetaSchema.parse(JSON.parse(line));
}

function synthesized(
  base: {
    runId: string;
    dir: string;
    file: string;
    meta: ScenarioMeta;
    target: SandboxRecord;
  },
  status: PlaytestReport["status"],
  reason: string,
  durationMs: number,
): PlaytestReport {
  return PlaytestReportSchema.parse({
    runId: base.runId,
    dir: base.dir,
    scenario: {
      name: base.meta.name,
      description: base.meta.description,
      file: base.file,
      sha256: "0".repeat(64),
    },
    target: { id: base.target.id, profile: base.target.profile },
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    durationMs,
    status,
    reason,
    steps: [],
    assertions: [],
    notes: [],
    artifacts: [],
  });
}

async function removeActors(
  target: Target | null,
  names: readonly string[],
  ctx: RunnerContext,
) {
  if (target === null || names.length === 0) {
    return;
  }
  const { actors } = await target.bridge.actorList();
  for (const actor of actors) {
    if (names.includes(actor.name)) {
      ActorRemoveResponseSchema.parse(
        await target.bridge.actorRemove(actor.name),
      );
      ctx.log("playtest removed leftover actor", { actor: actor.name });
    }
  }
}

type Planned = { file: string; meta: ScenarioMeta };

async function plan(
  ctx: RunnerContext,
  request: PlaytestRunRequest,
): Promise<Planned[]> {
  const planned: Planned[] = [];
  for (const file of request.files) {
    const meta = await describe(ctx.repoRoot, file);
    if (request.grep === undefined || meta.name.includes(request.grep)) {
      planned.push({ file, meta });
    }
  }
  if (planned.length === 0) {
    const filter =
      request.grep === undefined ? "" : ` --grep "${request.grep}"`;
    throw new Error(`No scenario matched${filter}`);
  }
  return planned;
}

/** The sandbox to run on, and whether this run created it. */
async function resolveSandbox(
  ctx: RunnerContext,
  request: PlaytestRunRequest,
  planned: readonly Planned[],
): Promise<{ record: SandboxRecord; created: boolean }> {
  if (request.target !== undefined) {
    const sandboxes = await ctx.provider.list();
    const found = sandboxes.find((sandbox) => sandbox.id === request.target);
    if (found?.status !== "ready") {
      throw new Error(`Sandbox ${request.target} is not running`);
    }
    return { record: found, created: false };
  }
  const profile =
    request.profile ?? planned[0]?.meta.requires.profiles[0] ?? "paper";
  const totalMs = planned.reduce(
    (sum, { meta }) => sum + meta.timeoutMs + CHILD_GRACE_MS,
    0,
  );
  const create: SandboxCreateRequest = {
    profile,
    world: request.world ?? "flat",
    ttlSeconds: Math.min(24 * 60 * 60, Math.ceil(totalMs / 1000) + 30 * 60),
    keep: request.keep,
  };
  await ctx.provider.reap(new Date());
  const record = await ctx.provider.create(create, (message) => {
    ctx.log("playtest sandbox", { message });
  });
  ctx.log("playtest sandbox ready", { id: record.id, profile });
  return { record, created: true };
}

async function runOne(
  ctx: RunnerContext,
  record: SandboxRecord,
  { file, meta }: Planned,
): Promise<PlaytestReport> {
  const runId = newRunId(new Date());
  const dir = path.join(ctx.runsDir ?? RUNS_DIR, runId);
  const started = Date.now();
  const deadlineMs = meta.timeoutMs + CHILD_GRACE_MS;
  ctx.log("playtest start", { runId, scenario: meta.name, target: record.id });
  const descriptor = {
    file,
    runId,
    runDir: dir,
    targetId: record.id,
    profile: record.profile,
  };
  const result = await runChild(
    ctx.repoRoot,
    ["run", JSON.stringify(descriptor)],
    deadlineMs,
  );
  const reportFile = Bun.file(path.join(dir, "report.json"));
  if (await reportFile.exists()) {
    const written: unknown = await reportFile.json();
    return PlaytestReportSchema.parse(written);
  }
  const why = result.killed
    ? `the scenario process was killed after ${deadlineMs.toString()}ms`
    : `the scenario process exited ${String(result.code)} without a report`;
  const report = synthesized(
    { runId, dir, file, meta, target: record },
    result.killed ? "timedOut" : "errored",
    `${why}:\n${result.stderr.slice(-STDERR_TAIL)}`,
    Date.now() - started,
  );
  await Bun.write(reportFile, JSON.stringify(report, null, 2));
  await removeActors(await ctx.target(record.id), meta.actors, ctx);
  return report;
}

/**
 * Runs playtest files one after another on one sandbox. Each scenario runs in
 * its own child process; the daemon only resolves the target, enforces the
 * deadline and cleans up after a killed child.
 */
export async function runPlaytests(
  ctx: RunnerContext,
  request: PlaytestRunRequest,
): Promise<PlaytestRunResponse> {
  const planned = await plan(ctx, request);
  const { record, created } = await resolveSandbox(ctx, request, planned);
  const reports: PlaytestReport[] = [];
  try {
    for (const entry of planned) {
      const report = await runOne(ctx, record, entry);
      ctx.log("playtest done", { runId: report.runId, status: report.status });
      reports.push(report);
    }
  } finally {
    if (created && !request.keep) {
      await ctx.provider.destroy(record.id);
    }
  }
  return {
    target: record.id,
    removedTarget: created && !request.keep,
    reports,
  };
}

/** Run summaries under the runs directory, newest first. */
export async function listRuns(runsDir = RUNS_DIR): Promise<PlaytestReport[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const reports: PlaytestReport[] = [];
  for (const entry of entries
    .filter((name) => name.startsWith("pt-"))
    .sort()
    .reverse()) {
    const file = Bun.file(path.join(runsDir, entry, "report.json"));
    if (await file.exists()) {
      reports.push(PlaytestReportSchema.parse(await file.json()));
    }
  }
  return reports;
}

export async function readRun(
  runId: string,
  runsDir = RUNS_DIR,
): Promise<PlaytestReport> {
  const file = Bun.file(path.join(runsDir, runId, "report.json"));
  if (!(await file.exists())) {
    throw new Error(`No playtest run ${runId}`);
  }
  return PlaytestReportSchema.parse(await file.json());
}
