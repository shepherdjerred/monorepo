/**
 * Runs the Minecraft harness evals against a coding agent (Codex or Claude
 * Code) and grades what it left behind. Manual only: it needs Docker, an
 * authenticated agent CLI, and real model spend.
 *
 *   bun packages/mc-harness/evals/run.ts --agent codex --tasks e1,e4 [--model m] [--parallel 2] [--keep]
 *
 * Each task gets a disposable detached worktree of HEAD and an isolated HOME,
 * so tasks never share a daemon or sandboxes. Reports land in
 * ~/.toolkit/mc/evals/<runId>/{report.md,report.json,<task>/…}.
 */
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { BRIDGE_BUILD_COMMAND, BRIDGE_JAR } from "#protocol/paths.ts";
import {
  type Agent,
  AgentSchema,
  agentInvocation,
  claudeLastMessage,
  parseUsage,
} from "#evals/lib/agents.ts";
import { DaemonClient } from "#evals/lib/daemon.ts";
import { prepareTaskEnvironment } from "#evals/lib/env.ts";
import { exec, execOk, type ExecResult } from "#evals/lib/exec.ts";
import { renderReport } from "#evals/lib/report.ts";
import { selectTasks, type TaskDef } from "#evals/lib/tasks.ts";
import type {
  CommandResult,
  GradeCheck,
  JudgeSummary,
  RunReport,
  TaskReport,
  TaskStatus,
} from "#evals/lib/types.ts";

const USAGE =
  "usage: bun packages/mc-harness/evals/run.ts --agent codex|claude [--model m] [--tasks e1,e3|all] [--parallel n] [--keep]\n";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    agent: { type: "string", default: "codex" },
    model: { type: "string" },
    tasks: { type: "string", default: "all" },
    parallel: { type: "string", default: "2" },
    keep: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const agent: Agent = AgentSchema.parse(values.agent);
const tasks = selectTasks(values.tasks);
const parallel = Number(values.parallel);
if (!Number.isInteger(parallel) || parallel < 1) {
  throw new Error(
    `--parallel must be a positive integer, got ${values.parallel}`,
  );
}
const realHome = os.homedir();
const toplevel = await execOk(["git", "rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
});
const repoRoot = toplevel.stdout.trim();
const headResult = await execOk(["git", "rev-parse", "HEAD"], {
  cwd: repoRoot,
});
const head = headResult.stdout.trim();
const now = new Date();
const stamp = now
  .toISOString()
  .replaceAll(/[-:]/gu, "")
  .replace(/\..*$/u, "")
  .replace("T", "-");
const runId = `ev-${stamp}-${randomBytes(2).toString("hex")}`;
const runDir = path.join(realHome, ".toolkit", "mc", "evals", runId);
await mkdir(runDir, { recursive: true });
const evalsDir = path.join(repoRoot, "packages", "mc-harness", "evals");
const preambles = {
  guided: await Bun.file(path.join(evalsDir, "tasks", "_preamble.md")).text(),
  natural: await Bun.file(
    path.join(evalsDir, "tasks", "_preamble-natural.md"),
  ).text(),
};

console.warn(
  `eval ${runId}: ${agent}, tasks ${tasks.map((task) => task.id).join(",")}, HEAD ${head.slice(0, 10)}`,
);
console.warn(`building MCBridge (${BRIDGE_BUILD_COMMAND})…`);
await execOk(
  [
    "mise",
    "exec",
    "--",
    "gradle",
    "-p",
    "packages/the-storm/plugin",
    ":bridge:assemble",
    "-q",
  ],
  {
    cwd: repoRoot,
  },
);
const bridgeJar = path.join(repoRoot, BRIDGE_JAR);

const ResultJsonSchema = z.record(z.string(), z.unknown());

async function readResult(
  outDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = ResultJsonSchema.safeParse(
      JSON.parse(await Bun.file(path.join(outDir, "result.json")).text()),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type Prepared = {
  task: TaskDef;
  taskDir: string;
  outDir: string;
  worktree: string;
  home: string;
  env: Record<string, string>;
  log: (message: string) => void;
};

async function prepare(task: TaskDef): Promise<Prepared> {
  const taskDir = path.join(runDir, task.id);
  const outDir = path.join(taskDir, "out");
  const worktree = path.join(taskDir, "repo");
  await mkdir(outDir, { recursive: true });
  const log = (message: string): void => {
    console.warn(`[${task.id}] ${message}`);
  };
  await execOk(["git", "worktree", "add", "--detach", worktree, head], {
    cwd: repoRoot,
  });
  try {
    log("installing dependencies");
    await execOk([process.execPath, "install", "--frozen-lockfile"], {
      cwd: worktree,
    });
    const jarTarget = path.join(worktree, BRIDGE_JAR);
    await mkdir(path.dirname(jarTarget), { recursive: true });
    await copyFile(bridgeJar, jarTarget);
    const { home, env } = await prepareTaskEnvironment({
      taskDir,
      worktree,
      realHome,
      baseEnv: Bun.env,
    });
    return { task, taskDir, outDir, worktree, home, env, log };
  } catch (error) {
    // Setup failed before the agent ran: nothing to grade, so drop the checkout.
    await exec(["git", "worktree", "remove", "--force", worktree], {
      cwd: repoRoot,
    });
    throw error;
  }
}

type AgentRun = {
  run: ExecResult;
  seconds: number;
  events: string;
  lastMessage: string;
};

async function runAgent(prepared: Prepared): Promise<AgentRun> {
  const { task, taskDir, outDir, worktree, env, log } = prepared;
  const taskText = await Bun.file(
    path.join(evalsDir, "tasks", task.file),
  ).text();
  const prompt = `${preambles[task.preamble]}\nOUT directory: ${outDir}\n\n${taskText}`;
  await Bun.write(path.join(taskDir, "prompt.md"), prompt);
  const lastMessagePath = path.join(taskDir, "last.md");
  const invocation = agentInvocation({
    agent,
    model: values.model ?? null,
    prompt,
    worktree,
    lastMessagePath,
    realHome,
  });
  log(`running ${agent} (timeout ${String(task.timeoutMinutes)} min)`);
  const started = Date.now();
  const eventsPath = path.join(taskDir, "events.jsonl");
  const run = await exec(invocation.argv, {
    cwd: worktree,
    env: { ...env, ...invocation.env },
    timeoutMs: task.timeoutMinutes * 60_000,
    stdoutFile: eventsPath,
    stderrFile: path.join(taskDir, "agent-stderr.log"),
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const events = await Bun.file(eventsPath).text();
  const lastMessage =
    agent === "claude"
      ? claudeLastMessage(events)
      : await Bun.file(lastMessagePath)
          .text()
          .catch(() => "");
  log(
    `agent finished in ${String(seconds)} s (exit ${String(run.exitCode)}${run.timedOut ? ", timed out" : ""})`,
  );
  return { run, seconds, events, lastMessage };
}

type Graded = {
  checks: GradeCheck[];
  artifacts: string[];
  notes: string[];
  judge?: JudgeSummary | null;
  error: string | null;
};

async function grade(
  prepared: Prepared,
  toolkit: (args: readonly string[]) => Promise<CommandResult>,
): Promise<Graded> {
  const { task, taskDir, outDir, home, worktree, env, log } = prepared;
  const daemon = new DaemonClient(home);
  if (!(await daemon.alive())) {
    log("daemon not running after the agent; starting it to grade");
    await toolkit(["mc", "daemon", "start"]);
  }
  log("grading");
  try {
    const graded = await task.grade({
      taskId: task.id,
      taskDir,
      outDir,
      home,
      worktree,
      result: await readResult(outDir),
      daemon,
      toolkit,
      exec: async (argv) => exec(argv, { cwd: worktree, env }),
    });
    return { ...graded, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      checks: [],
      artifacts: [],
      notes: [`grader error: ${message}`],
      error: message,
    };
  }
}

function statusOf(agentRun: AgentRun, graded: Graded): TaskStatus {
  if (agentRun.run.timedOut) {
    return "timeout";
  }
  if (graded.error !== null) {
    return "error";
  }
  return graded.checks.length > 0 && graded.checks.every((check) => check.pass)
    ? "passed"
    : "failed";
}

async function runTask(task: TaskDef): Promise<TaskReport> {
  const prepared = await prepare(task);
  const toolkit = async (args: readonly string[]): Promise<CommandResult> =>
    exec([path.join(prepared.home, "bin", "toolkit"), ...args], {
      cwd: prepared.worktree,
      env: prepared.env,
    });
  try {
    const agentRun = await runAgent(prepared);
    const graded = await grade(prepared, toolkit);
    return {
      id: task.id,
      title: task.title,
      status: statusOf(agentRun, graded),
      agentExitCode: agentRun.run.timedOut ? null : agentRun.run.exitCode,
      seconds: agentRun.seconds,
      usage: parseUsage(agent, agentRun.events),
      checks: graded.checks,
      artifacts: graded.artifacts,
      notes: graded.notes,
      judge: graded.judge ?? null,
      lastMessage: agentRun.lastMessage,
      taskDir: prepared.taskDir,
    };
  } finally {
    if (values.keep) {
      prepared.log(
        `kept worktree ${prepared.worktree} and HOME ${prepared.home}`,
      );
    } else {
      prepared.log("cleaning up sandboxes, daemon and worktree");
      await toolkit(["mc", "sandbox", "down", "--all"]);
      await toolkit(["mc", "daemon", "stop"]);
      await exec(["git", "worktree", "remove", "--force", prepared.worktree], {
        cwd: repoRoot,
      });
      await rm(prepared.home, { recursive: true, force: true });
    }
  }
}

function setupFailure(task: TaskDef, error: unknown): TaskReport {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[${task.id}] failed before grading: ${message}`);
  return {
    id: task.id,
    title: task.title,
    status: "error",
    agentExitCode: null,
    seconds: 0,
    usage: null,
    checks: [],
    artifacts: [],
    notes: [`setup error: ${message}`],
    judge: null,
    lastMessage: "",
    taskDir: path.join(runDir, task.id),
  };
}

async function runAll(): Promise<TaskReport[]> {
  const reports: TaskReport[] = [];
  const queue = [...tasks];
  const workers = Array.from(
    { length: Math.min(parallel, queue.length) },
    async () => {
      for (let task = queue.shift(); task !== undefined; task = queue.shift()) {
        const current = task;
        reports.push(
          await runTask(current).catch((error: unknown) =>
            setupFailure(current, error),
          ),
        );
      }
    },
  );
  await Promise.all(workers);
  return reports.toSorted((a, b) => a.id.localeCompare(b.id));
}

const report: RunReport = {
  runId,
  startedAt: now.toISOString(),
  agent,
  model: values.model ?? null,
  head,
  tasks: await runAll(),
};
await exec(["git", "worktree", "prune"], { cwd: repoRoot });
await Bun.write(
  path.join(runDir, "report.json"),
  JSON.stringify(report, null, 2),
);
const reportPath = path.join(runDir, "report.md");
await Bun.write(reportPath, renderReport(report));
process.stdout.write(`${reportPath}\n`);
process.exitCode = report.tasks.every((task) => task.status === "passed")
  ? 0
  : 1;
