/**
 * The build bench: rates promoted builds from eval runs against fixed
 * anchors with a vision judge, and keeps the history in the repository.
 *
 *   bun packages/mc-harness/evals/bench/bench.ts collect --run <runId|dir>
 *   bun packages/mc-harness/evals/bench/bench.ts judge --task m1 [--model id] [--samples 200]
 *   bun packages/mc-harness/evals/bench/bench.ts anchor <slug> [<file.schem> | --program <build.ts>] --rubric micro|map --source <text> --licence <text> [--weak]
 *   bun packages/mc-harness/evals/bench/bench.ts report
 *
 * `collect` needs no model: it renders judge sheets, lints and hashes.
 * `judge` spends model calls only on pairs and entries it has not judged
 * before (cached by sheet hash). `report` is offline.
 */
import { mkdir, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import {
  DEFAULT_JUDGE_MODEL,
  judgeFingerprint,
  llmJudge,
  llmScorer,
  parseRubric,
  scoreAbsolute,
  scoreFingerprint,
} from "#build/judge.ts";
import { rate } from "#evals/bench/lib/bradley-terry.ts";
import {
  assetSheetRenderer,
  collectEntry,
  type SheetRenderer,
} from "#evals/bench/lib/collect.ts";
import {
  BENCH_DIR,
  BENCH_FILES,
  BENCH_HOME,
  entryId,
  latestTournament,
  listEntries,
  listTasks,
  PairCacheSchema,
  taskHistoryDir,
  type Entry,
  type PairCache,
  type ScoresFile,
  type TournamentFile,
  scoreBy,
  sha256,
  type ScoreRecord,
} from "#evals/bench/lib/entries.ts";
import {
  leaderboardIndex,
  renderLeaderboard,
  type TaskBoard,
} from "#evals/bench/lib/leaderboard.ts";
import { runTournament, type Contestant } from "#evals/bench/lib/tournament.ts";
import { BENCH_TASKS, benchTask } from "#evals/bench/tasks.ts";
import { UsageSchema } from "#evals/bench/lib/entries.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    run: { type: "string" },
    task: { type: "string" },
    model: { type: "string" },
    rubric: { type: "string" },
    samples: { type: "string", default: "200" },
    all: { type: "boolean", default: false },
    source: { type: "string" },
    licence: { type: "string" },
    weak: { type: "boolean", default: false },
    program: { type: "string" },
  },
  allowPositionals: true,
});
const [command, ...rest] = positionals;

const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

function usage(): never {
  log(
    "usage: bench.ts collect --run <runId|dir> | judge --task <id> [--model id] [--samples n] | anchor <slug> [<file.schem> | --program <build.ts>] --rubric micro|map --source <text> --licence <text> [--weak] | report",
  );
  process.exit(1);
}

const RunReportSchema = z.object({
  runId: z.string(),
  head: z.string(),
  agent: z.string(),
  model: z.string().nullable(),
  tasks: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      seconds: z.number(),
      usage: UsageSchema.nullable(),
      checks: z.array(z.object({ pass: z.boolean() })),
      taskDir: z.string(),
    }),
  ),
});

async function collect(): Promise<void> {
  const run = values.run ?? usage();
  const runDir = (await Bun.file(path.join(run, "report.json")).exists())
    ? run
    : path.join(os.homedir(), ".toolkit", "mc", "evals", run);
  const runReport = RunReportSchema.parse(
    JSON.parse(await Bun.file(path.join(runDir, "report.json")).text()),
  );
  const registry = await loadRegistry();
  // Made on the first entry that is actually collected: a run with nothing
  // to collect never loads (or fetches) the Mojang assets.
  let renderSheet: SheetRenderer | null = null;
  let collected = 0;
  for (const task of BENCH_TASKS) {
    const result = runReport.tasks.find(
      (candidate) => candidate.id === task.id,
    );
    if (result === undefined) continue;
    const schematicFile = path.join(result.taskDir, "promoted-site.schem");
    if (!(await Bun.file(schematicFile).exists())) {
      log(`${task.id}: no promoted-site.schem in ${result.taskDir}; skipped`);
      continue;
    }
    const id = entryId(runReport.head, runReport.agent, runReport.runId);
    const siteFile = Bun.file(path.join(result.taskDir, "captured-site.schem"));
    if (!(await siteFile.exists())) {
      // Without the baseline, repetition would be measured on the whole site,
      // which is a different metric; a run from an older grader is not collected.
      log(
        `${task.id}: no captured-site.schem in ${result.taskDir}; skipped (the grader keeps one only when the build's capture matches its promoted site; see the task's delivered checks, or re-grade with the current grader)`,
      );
      continue;
    }
    renderSheet ??= await assetSheetRenderer();
    const meta = await collectEntry({
      schematic: new Uint8Array(await Bun.file(schematicFile).arrayBuffer()),
      site: new Uint8Array(await siteFile.arrayBuffer()),
      registry,
      renderSheet,
      dir: path.join(taskHistoryDir(task.id), id),
      schematicOut: path.join(BENCH_HOME, task.id, id, "site.schem"),
      meta: {
        id,
        task: task.id,
        rubric: task.rubric,
        anchor: false,
        weak: false,
        head: runReport.head,
        agent: runReport.agent,
        model: runReport.model,
        runId: runReport.runId,
        collectedAt: new Date().toISOString(),
        source: null,
        licence: null,
        seconds: result.seconds,
        usage: result.usage,
        checks: {
          passed: result.checks.filter((check) => check.pass).length,
          total: result.checks.length,
        },
      },
    });
    collected += 1;
    log(
      `${task.id}: ${id} — ${meta.blocks.toString()} blocks, lint ${meta.lint.errors.toString()}/${meta.lint.warnings.toString()}, repetition ${meta.repetition.toString()}`,
    );
  }
  log(`collected ${collected.toString()} entries from ${runReport.runId}`);
}

/** A schematic from a file, or compiled from a build program (`--program`). */
async function anchorSchematic(
  file: string | undefined,
  registry: Awaited<ReturnType<typeof loadRegistry>>,
): Promise<Uint8Array> {
  if (values.program !== undefined) {
    const compiled = await compileProgram({
      program: path.resolve(values.program),
      seed: 1,
      anchor: { x: 0, y: 0, z: 0 },
      site: null,
    });
    return writeSchematic(compiled.grid, registry.dataVersion);
  }
  if (file === undefined) usage();
  return new Uint8Array(await Bun.file(file).arrayBuffer());
}

async function anchor(): Promise<void> {
  const [slug, file] = rest;
  if (slug === undefined) usage();
  const rubric = parseRubric(values.rubric);
  const source = values.source ?? usage();
  const licence = values.licence ?? usage();
  const registry = await loadRegistry();
  const renderSheet = await assetSheetRenderer();
  const id = `anchor-${slug}`;
  const meta = await collectEntry({
    schematic: await anchorSchematic(file, registry),
    registry,
    renderSheet,
    dir: path.join(BENCH_DIR, BENCH_FILES.anchors, slug),
    schematicOut: path.join(BENCH_HOME, "anchors", slug, "site.schem"),
    meta: {
      id,
      task: "anchor",
      rubric,
      anchor: true,
      weak: values.weak,
      head: "",
      agent: null,
      model: null,
      runId: null,
      collectedAt: new Date().toISOString(),
      source,
      licence,
      seconds: null,
      usage: null,
      checks: { passed: 0, total: 0 },
    },
  });
  log(
    `anchor ${id} (${rubric}${values.weak ? ", weak" : ""}): ${meta.blocks.toString()} blocks`,
  );
}

async function contestant(entry: Entry): Promise<Contestant> {
  const data = new Uint8Array(await Bun.file(entry.sheet).arrayBuffer());
  return {
    id: entry.meta.id,
    sha256: sha256(data),
    image: { data, mediaType: "image/jpeg" },
  };
}

async function scoreEntries(
  entries: readonly Entry[],
  contestants: readonly Contestant[],
  options: { model: string; rubric: TournamentFile["rubric"] },
): Promise<number> {
  let scored = 0;
  let scorer: ReturnType<typeof llmScorer> | null = null;
  for (const [index, entry] of entries.entries()) {
    const current = contestants[index];
    if (current === undefined) continue;
    const sheetSha256 = current.sha256;
    const scorerId = {
      model: options.model,
      judge: scoreFingerprint(options.rubric),
    };
    const existing = scoreBy(entry.scores, scorerId);
    if (existing !== null && existing.sheetSha256 === sheetSha256) {
      continue;
    }
    scorer ??= llmScorer(options.model, options.rubric);
    const scores = await scoreAbsolute(current.image, scorer, options);
    const record: ScoreRecord = {
      at: new Date().toISOString(),
      ...scorerId,
      rubric: options.rubric,
      sheetSha256,
      axes: scores.axes,
      overallAesthetic: scores.overallAesthetic,
      total: scores.total,
      max: scores.max,
      notes: scores.notes,
    };
    // Other judges' scores stay; this judge's earlier score of an older sheet goes.
    const file: ScoresFile = [
      ...entry.scores.filter(
        (item) =>
          item.model !== scorerId.model || item.judge !== scorerId.judge,
      ),
      record,
    ];
    await Bun.write(
      path.join(entry.dir, BENCH_FILES.scores),
      `${JSON.stringify(file, null, 2)}\n`,
    );
    scored += 1;
    log(
      `  scored ${entry.meta.id}: ${scores.total.toString()}/${scores.max.toString()}, æ ${scores.overallAesthetic.toString()}`,
    );
  }
  return scored;
}

async function judge(): Promise<void> {
  const task = benchTask(values.task ?? usage());
  const model = values.model ?? DEFAULT_JUDGE_MODEL;
  // Checked before any model call: a bad bootstrap count must not cost a round.
  const samples = Number(values.samples);
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(
      `--samples must be a positive integer (got "${values.samples}")`,
    );
  }
  const entries = await listEntries(task.id, task.rubric);
  if (entries.length < 2) {
    log(`${task.id}: ${entries.length.toString()} entries; nothing to compare`);
    return;
  }
  const contestants = await Promise.all(
    entries.map((entry) => contestant(entry)),
  );
  const historyDir = taskHistoryDir(task.id);
  const cacheFile = path.join(historyDir, BENCH_FILES.pairCache);
  const cache: PairCache = (await Bun.file(cacheFile).exists())
    ? PairCacheSchema.parse(JSON.parse(await Bun.file(cacheFile).text()))
    : {};
  await mkdir(historyDir, { recursive: true });
  // Written after every judged pair: a failed call later in the round keeps
  // the verdicts already paid for, and the next `judge` resumes from them.
  // Written beside the cache and renamed over it, so a process killed
  // mid-write never leaves a half-written cache the next run cannot parse.
  const persist = async (judged: PairCache): Promise<void> => {
    const staging = `${cacheFile}.tmp`;
    await Bun.write(staging, `${JSON.stringify(judged, null, 2)}\n`);
    await rename(staging, cacheFile);
  };
  let ask: ReturnType<typeof llmJudge> | null = null;
  const run = await runTournament(contestants, {
    ask: (first, second) => {
      ask ??= llmJudge(model, task.rubric);
      return ask(first, second);
    },
    model,
    rubric: task.rubric,
    cache,
    onPair: (outcome, cached) => {
      log(
        `  ${outcome.a} vs ${outcome.b}: ${outcome.winner}${outcome.agreed ? "" : " (disagreed)"}${cached ? " [cached]" : ""}`,
      );
    },
    persist,
  });
  await persist(run.cache);
  const scored = await scoreEntries(entries, contestants, {
    model,
    rubric: task.rubric,
  });
  const anchors = entries
    .filter((entry) => entry.meta.anchor)
    .map((entry) => entry.meta.id);
  const ratings = rate(
    entries.map((entry) => entry.meta.id),
    run.pairs,
    { anchors, samples },
  );
  const at = new Date().toISOString();
  const tournament: TournamentFile = {
    at,
    task: task.id,
    rubric: task.rubric,
    model,
    judge: judgeFingerprint(task.rubric),
    entries: entries.map((entry) => entry.meta.id),
    anchors,
    sheets: Object.fromEntries(
      contestants.map((item) => [item.id, item.sha256]),
    ),
    pairs: run.pairs,
    ratings,
  };
  const dir = path.join(historyDir, BENCH_FILES.tournaments);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${at.replaceAll(/[:.]/gu, "-")}.json`);
  await Bun.write(file, `${JSON.stringify(tournament, null, 2)}\n`);
  log(
    `${task.id}: ${run.pairs.length.toString()} pairs (${run.judged.toString()} judged now), ${scored.toString()} scored now → ${file}`,
  );
  const ranked = Object.entries(ratings).toSorted(
    ([, x], [, y]) => y.rating - x.rating,
  );
  for (const [id, rating] of ranked) {
    log(
      `  ${rating.rating.toFixed(0).padStart(5)} [${rating.lo.toFixed(0)}, ${rating.hi.toFixed(0)}]  ${id}`,
    );
  }
}

async function report(): Promise<void> {
  const tasks = new Set([
    ...(await listTasks()),
    ...BENCH_TASKS.filter((task) => !task.optional || values.all).map(
      (task) => task.id,
    ),
  ]);
  const boards: TaskBoard[] = [];
  for (const id of [...tasks].toSorted()) {
    const task = BENCH_TASKS.find((candidate) => candidate.id === id);
    if (task === undefined) continue;
    const entries = await listEntries(task.id, task.rubric);
    if (entries.length === 0) continue;
    boards.push({
      task: task.id,
      rubric: task.rubric,
      entries,
      tournament: await latestTournament(task.id),
    });
  }
  await mkdir(path.join(BENCH_DIR, BENCH_FILES.history), { recursive: true });
  const leaderboard = path.join(BENCH_DIR, BENCH_FILES.leaderboard);
  await Bun.write(leaderboard, renderLeaderboard(boards));
  await Bun.write(
    path.join(BENCH_DIR, BENCH_FILES.index),
    `${JSON.stringify(leaderboardIndex(boards), null, 2)}\n`,
  );
  log(`${boards.length.toString()} task boards → ${leaderboard}`);
}

const commands: Record<string, () => Promise<void>> = {
  collect,
  judge,
  anchor,
  report,
};
const handler = command === undefined ? undefined : commands[command];
if (handler === undefined) {
  usage();
}
await handler();
