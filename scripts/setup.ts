#!/usr/bin/env bun

import { $, which } from "bun";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = import.meta.dirname
  ? join(import.meta.dirname, "..")
  : process.cwd();

// ── Package groups (scoped worktree installs) ───────────────────────────
//
// A worktree that only touches one package pays for installing all ~35 —
// ~13-15G of node_modules it never uses. --group=<name> scopes Phase 2/3/4/5
// to one of these plus the shared `file:` producers every group needs
// (always installed/built regardless of group; they're cheap — see
// SHARED_PRODUCER_* below). --link additionally installs the group's own
// dir(s) with Bun's --backend=symlink instead of the default clonefile,
// linking from Bun's shared global store. Full runs (no --group) are
// unchanged.

const PACKAGE_GROUPS: Record<string, string[]> = {
  scout: ["packages/scout-for-lol"],
  pokemon: ["packages/discord-plays-pokemon"],
  mk64: ["packages/discord-plays-mario-kart"],
  birmel: ["packages/birmel"],
};

// Lockfile dirs for the shared `file:` producers (eslint-config, llm-models,
// webring, astro-opengraph-images, discord-video-stream, helm-types). Always
// installed regardless of --group — per the setup-cost profiling log these
// total well under 4s combined, and always building them is what prevents a
// scoped worktree from ending up with a stale/missing shared dep (the
// recurring "Cannot find module @shepherdjerred/eslint-config" failure).
const SHARED_PRODUCER_DIRS = [
  "packages/eslint-config",
  "packages/webring",
  "packages/llm-models",
  "packages/astro-opengraph-images",
  "packages/discord-video-stream",
  "packages/homelab/src/helm-types",
];

// Matching DAG_TASKS ids for the same shared producers (see Phase 3 below).
const SHARED_PRODUCER_DAG_IDS = new Set([
  "eslint-config",
  "webring",
  "llm-models",
  "astro-og",
  "discord-video-stream",
  "helm-types-build",
]);

// Each group's own DAG tasks, beyond the always-on shared producers.
// scout-generate's real DAG_TASKS entry also depends on "birmel-prisma" —
// that edge exists only to keep two concurrent `prisma generate` runs (which
// share Bun's engine-binary download/cache) from racing during a full run.
// It's not a functional dependency of scout's own generate step, and birmel
// isn't installed in a scout-scoped run anyway, so scopedDagTasks() below
// strips any dep edge pointing outside the selected group's task set.
const GROUP_DAG_ENTRYPOINTS: Record<string, string[]> = {
  scout: ["scout-llm-models-refresh", "scout-generate"],
  pokemon: [],
  mk64: ["mario-kart-prisma"],
  birmel: ["birmel-prisma"],
};

// Groups verified safe for --link (Bun's --backend=symlink). Tested live:
// scout, mk64, and birmel all fail under --link — NOT because of the
// node_modules-write risk this was originally designed around (that only
// applies to birmel; scout/mk64 generate their Prisma client outside
// node_modules), but because Prisma's own postinstall scripts
// (@prisma/engines, prisma) `require()` their own sibling deps (e.g.
// "@prisma/debug") assuming they're running from a real project
// node_modules tree. Under symlink backend they execute directly from Bun's
// shared global cache instead, where those siblings aren't resolvable, and
// the postinstall crashes with MODULE_NOT_FOUND. Confirmed reproducible for
// both scout (`@prisma/engines` postinstall) and mk64 (`prisma` postinstall);
// birmel uses the same prisma toolchain so almost certainly hits the same
// failure. pokemon has no Prisma dependency and its `--link` install
// completes cleanly. Any group added to PACKAGE_GROUPS in the future needs
// the same live test — don't assume safety from a static audit alone.
const LINK_SAFE_GROUPS = new Set(["pokemon"]);

function parseArgs(): { group: string | undefined; link: boolean } {
  let group: string | undefined;
  let link = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--link") {
      link = true;
    } else if (arg.startsWith("--group=")) {
      group = arg.slice("--group=".length);
    } else {
      throw new Error(
        `Unknown argument "${arg}". Valid flags: --group=<name>, --link`,
      );
    }
  }
  if (group !== undefined && !(group in PACKAGE_GROUPS)) {
    const valid = Object.keys(PACKAGE_GROUPS).join(", ");
    throw new Error(`Unknown --group "${group}". Valid groups: ${valid}`);
  }
  if (link && group === undefined) {
    throw new Error("--link requires --group=<name>");
  }
  if (link && group !== undefined && !LINK_SAFE_GROUPS.has(group)) {
    const valid = [...LINK_SAFE_GROUPS].join(", ");
    throw new Error(
      `--link is not safe for --group=${group}: its Prisma postinstall ` +
        `scripts fail under Bun's symlink backend (tested — MODULE_NOT_FOUND ` +
        `resolving their own sibling deps from Bun's global cache). ` +
        `--link is currently only verified safe for: ${valid}. ` +
        `Run --group=${group} without --link instead.`,
    );
  }
  return { group, link };
}

const { group: GROUP, link: LINK } = parseArgs();

// ── Utilities ──────────────────────────────────────────────────────────

function elapsed(startMs: number): string {
  return `${((performance.now() - startMs) / 1000).toFixed(1)}s`;
}

function log(phase: string, msg: string): void {
  console.log(`  [${phase}] ${msg}`);
}

function warn(phase: string, msg: string): void {
  console.warn(`  [${phase}] ⚠ ${msg}`);
}

async function phase(name: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  console.log(`\n── ${name} ──`);
  await fn();
  console.log(`── ${name} done (${elapsed(start)}) ──`);
}

async function exec(
  phaseName: string,
  label: string,
  cmd: string[],
  opts?: { cwd?: string; warnOnly?: boolean },
): Promise<boolean> {
  const start = performance.now();
  const cwd = opts?.cwd ?? ROOT;
  try {
    await $`${cmd}`.cwd(cwd).quiet();
    log(phaseName, `${label}... done (${elapsed(start)})`);
    return true;
  } catch (error) {
    const msg = `${label}... FAILED (${elapsed(start)})`;
    if (opts?.warnOnly) {
      warn(phaseName, msg);
      return false;
    }
    console.error(`  [${phaseName}] ${msg}`);
    const shellErr = error as {
      stderr?: Buffer;
      stdout?: Buffer;
      message?: string;
    };
    if (shellErr.stderr?.length) {
      console.error(`  stderr:\n${shellErr.stderr.toString().trimEnd()}`);
    }
    if (shellErr.stdout?.length) {
      console.error(`  stdout:\n${shellErr.stdout.toString().trimEnd()}`);
    }
    if (
      !shellErr.stderr?.length &&
      !shellErr.stdout?.length &&
      error instanceof Error
    ) {
      console.error(`  ${error.message}`);
    }
    throw error;
  }
}

function hasTool(name: string): boolean {
  return which(name) !== null;
}

async function findMiseConfigs(): Promise<string[]> {
  const configs: string[] = [];
  const skip = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    "target",
    "archive",
    "poc",
    "practice",
  ]);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(fullPath);
      } else if (entry.name === "mise.toml" || entry.name === ".mise.toml") {
        configs.push(fullPath);
      }
    }
  }

  await walk(ROOT);
  return configs.sort();
}

async function trustMiseConfigs(configs: string[]): Promise<void> {
  for (const cfg of configs) {
    await exec("Tools", `mise trust ${relative(ROOT, cfg)}`, [
      "mise",
      "trust",
      "-y",
      cfg,
    ]);
  }
}

// ── Phase 1: Tools ─────────────────────────────────────────────────────

async function ensureTools(): Promise<void> {
  const miseConfigs = await findMiseConfigs();
  log("Tools", `Found ${String(miseConfigs.length)} mise config files`);
  await trustMiseConfigs(miseConfigs);
  log("Tools", "Trusted all mise configs");

  await exec("Tools", "mise install", ["mise", "install"]);

  const isMac = process.platform === "darwin";

  const optionalTools: Array<{
    name: string;
    reason: string;
    macOnly?: boolean;
  }> = [
    { name: "helm", reason: "homelab helm-types generation" },
    { name: "go", reason: "terraform-provider-asuswrt" },
    { name: "golangci-lint", reason: "Go linting (pre-commit)" },
    { name: "gitleaks", reason: "secret scanning (pre-commit)" },
    { name: "shellcheck", reason: "shell script linting (pre-commit)" },
  ];

  const missing: string[] = [];
  for (const tool of optionalTools) {
    if (tool.macOnly && !isMac) continue;
    if (!hasTool(tool.name)) {
      missing.push(`${tool.name} (${tool.reason})`);
    }
  }

  if (missing.length > 0) {
    warn("Tools", `Optional tools not found:`);
    for (const m of missing) {
      console.warn(`           - ${m}`);
    }
  }
}

// ── Phase 2: Dependencies ──────────────────────────────────────────────

async function installDependencies(): Promise<void> {
  // One root workspace install covers every member (bun workspaces + isolated
  // linker, all internal deps on workspace:*) — the old per-package fan-out
  // (28 installs, cache contention, retry/backoff) and its copy-refresh phase
  // are gone with the per-package lockfiles; workspace:* is a live symlink,
  // so there's nothing to re-copy after a shared producer builds.
  //
  // --group scopes the install to one group's own package(s) plus the
  // always-on shared `file:` producers via `bun install --filter`, instead of
  // installing all ~35 workspace members. --link additionally installs with
  // Bun's --backend=symlink (only for LINK_SAFE_GROUPS — see parseArgs).
  const filterDirs =
    GROUP === undefined
      ? []
      : [...PACKAGE_GROUPS[GROUP], ...SHARED_PRODUCER_DIRS];
  const filterArgs = filterDirs.flatMap((dir) => ["--filter", `./${dir}`]);
  const cmd =
    LINK && GROUP !== undefined
      ? [
          "bun",
          "install",
          "--frozen-lockfile",
          "--backend=symlink",
          ...filterArgs,
        ]
      : ["bun", "install", "--frozen-lockfile", ...filterArgs];
  await exec(
    "Deps",
    GROUP === undefined ? "bun install" : `bun install --group=${GROUP}`,
    cmd,
  );
}

// ── Phase 3: Build & Generate (DAG) ────────────────────────────────────

type DagTask = {
  id: string;
  label: string;
  cmd: string[];
  cwd: string;
  deps: string[];
  warnOnly: boolean;
};

const DAG_TASKS: DagTask[] = [
  {
    id: "eslint-config",
    label: "eslint-config build",
    cmd: ["bun", "run", "build"],
    cwd: "packages/eslint-config",
    deps: [],
    warnOnly: false,
  },
  {
    id: "webring",
    label: "webring build",
    cmd: ["bun", "run", "build"],
    cwd: "packages/webring",
    deps: [],
    warnOnly: false,
  },
  {
    id: "llm-models",
    label: "llm-models build",
    cmd: ["bun", "run", "build"],
    cwd: "packages/llm-models",
    deps: [],
    warnOnly: false,
  },
  {
    id: "astro-og",
    label: "astro-opengraph-images build",
    cmd: ["bun", "run", "build"],
    cwd: "packages/astro-opengraph-images",
    deps: [],
    warnOnly: false,
  },
  {
    id: "discord-video-stream",
    label: "discord-video-stream build (d.ts)",
    cmd: ["bun", "run", "build"],
    cwd: "packages/discord-video-stream",
    deps: [],
    warnOnly: false,
  },
  {
    id: "helm-types-build",
    label: "helm-types build",
    cmd: ["bun", "run", "build"],
    cwd: "packages/homelab/src/helm-types",
    deps: [],
    warnOnly: false,
  },
  // NOTE: We intentionally do NOT regenerate helm types here. The generated
  // types in packages/homelab/src/cdk8s/generated/helm are committed to the
  // repo and are the source of truth. Regenerating them requires a network
  // round-trip per chart (`helm pull`), which dominated setup time (~2 min) and
  // caused churn/drift. The "helm-types-weekly-refresh" Temporal schedule
  // (packages/temporal/src/schedules/register-schedules.ts) regenerates them
  // from the live charts weekly and opens a PR if they drifted.
  {
    id: "birmel-prisma",
    label: "birmel prisma",
    cmd: ["bunx", "--trust", "prisma", "generate"],
    cwd: "packages/birmel",
    deps: [],
    warnOnly: false,
  },
  {
    id: "scout-llm-models-refresh",
    label: "scout-for-lol llm-models refresh",
    // scout's generate imports @shepherdjerred/llm-models via a file: dep; the .bun copy made
    // during Phase 2 install predates the llm-models build in this DAG, so re-copy it first.
    // Preserve --backend=symlink here for --group=scout --link — otherwise this
    // bare --force re-links the whole workspace with the default backend,
    // silently undoing Phase 2's symlink install (see refreshBuiltFileDependencies
    // for the same issue on discord-plays-pokemon's backend). Currently inert:
    // scout isn't in LINK_SAFE_GROUPS, so `--group=scout --link` is rejected in
    // parseArgs before this ever runs, and the true branch here is unreachable.
    // Written this way so it activates automatically if scout is ever added to
    // LINK_SAFE_GROUPS, rather than needing this task revisited too.
    cmd:
      LINK && GROUP === "scout"
        ? ["bun", "install", "--force", "--backend=symlink"]
        : ["bun", "install", "--force"],
    cwd: "packages/scout-for-lol",
    deps: ["llm-models"],
    warnOnly: false,
  },
  {
    id: "scout-generate",
    label: "scout-for-lol generate",
    cmd: ["bun", "run", "generate"],
    cwd: "packages/scout-for-lol",
    deps: ["birmel-prisma", "scout-llm-models-refresh"],
    warnOnly: false,
  },
  {
    id: "mario-kart-prisma",
    label: "discord-plays-mario-kart prisma",
    cmd: ["bunx", "--trust", "prisma", "generate"],
    cwd: "packages/discord-plays-mario-kart/packages/backend",
    deps: [],
    warnOnly: false,
  },
];

// Scopes DAG_TASKS to the shared producers plus one group's own entrypoints
// (GROUP_DAG_ENTRYPOINTS lists each group's tasks flatly — deliberately not
// resolved transitively via each task's `deps`, since a group's real
// DAG_TASKS entry can carry a full-run-only ordering edge to another group's
// task, e.g. scout-generate's "birmel-prisma" edge: see the
// GROUP_DAG_ENTRYPOINTS comment above for why that's safe to drop). Any dep
// edge pointing outside the wanted set is stripped — without that, a task
// waiting on an unscheduled dep would sit unsatisfied in runDag's
// `remaining` map forever and get silently dropped.
function scopedDagTasks(tasks: DagTask[], group: string): DagTask[] {
  const wanted = new Set([
    ...SHARED_PRODUCER_DAG_IDS,
    ...(GROUP_DAG_ENTRYPOINTS[group] ?? []),
  ]);

  return tasks
    .filter((t) => wanted.has(t.id))
    .map((t) => ({ ...t, deps: t.deps.filter((d) => wanted.has(d)) }));
}

async function runDag(
  tasks: DagTask[],
  maxConcurrency: number = 4,
): Promise<void> {
  // Filter to tasks whose directories exist
  const valid = tasks.filter((t) => {
    const fullCwd = join(ROOT, t.cwd);
    if (!existsSync(fullCwd)) {
      warn("DAG", `${t.label} skipped (directory not found)`);
      return false;
    }
    return true;
  });

  const completed = new Set<string>();
  const failed = new Set<string>();
  const running = new Map<string, Promise<string>>();
  const remaining = new Map(valid.map((t) => [t.id, t]));

  while (remaining.size > 0 || running.size > 0) {
    // Launch ready tasks up to concurrency limit
    for (const [id, task] of remaining) {
      if (running.size >= maxConcurrency) break;

      if (task.deps.some((d) => failed.has(d))) {
        remaining.delete(id);
        failed.add(id);
        warn("DAG", `${task.label} skipped (dependency failed)`);
        continue;
      }

      if (task.deps.every((d) => completed.has(d))) {
        remaining.delete(id);
        const promise = exec("DAG", task.label, task.cmd, {
          cwd: join(ROOT, task.cwd),
          warnOnly: task.warnOnly,
        })
          .then((ok) => {
            if (!ok) failed.add(id);
            return id;
          })
          .catch(() => {
            failed.add(id);
            return id;
          });
        running.set(id, promise);
      }
    }

    if (running.size === 0) break;

    // Wait for any task to finish
    const doneId = await Promise.race(running.values());
    running.delete(doneId);
    if (!failed.has(doneId)) {
      completed.add(doneId);
    }
  }

  // Check for fatal failures
  const fatalFailures = valid.filter((t) => failed.has(t.id) && !t.warnOnly);
  if (fatalFailures.length > 0) {
    console.error(
      `  [DAG] Fatal failures: ${fatalFailures.map((t) => t.label).join(", ")}`,
    );
    throw new Error("Build/generate tasks failed");
  }
}

// ── Phase 4: Verify ────────────────────────────────────────────────────

async function verifySetup(): Promise<void> {
  const checks: Array<{ label: string; path: string; group?: string }> = [
    {
      label: "eslint-config dist",
      path: "packages/eslint-config/dist/index.js",
    },
    { label: "webring dist", path: "packages/webring/dist/index.js" },
    {
      label: "astro-opengraph-images dist",
      path: "packages/astro-opengraph-images/dist/index.js",
    },
    {
      label: "discord-video-stream d.ts",
      path: "packages/discord-video-stream/dist/index.d.ts",
    },
    {
      label: "helm-types dist",
      path: "packages/homelab/src/helm-types/dist/cli.js",
    },
    {
      label: "birmel prisma client",
      path: "packages/birmel/generated/prisma/client/index.js",
      group: "birmel",
    },
    {
      label: "scout-for-lol prisma client",
      path: "packages/scout-for-lol/packages/backend/generated/prisma/client/index.js",
      group: "scout",
    },
    {
      label: "discord-plays-mario-kart prisma client",
      path: "packages/discord-plays-mario-kart/packages/backend/generated/prisma/client/index.js",
      group: "mk64",
    },
  ];

  const relevant = checks.filter(
    (c) => c.group === undefined || GROUP === undefined || c.group === GROUP,
  );

  let passed = 0;
  for (const check of relevant) {
    const fullPath = join(ROOT, check.path);
    if (existsSync(fullPath)) {
      passed++;
    } else {
      warn("Verify", `${check.label} not found at ${check.path}`);
    }
  }

  log(
    "Verify",
    `${String(passed)}/${String(relevant.length)} artifacts present`,
  );
}

// ── Main ───────────────────────────────────────────────────────────────

const totalStart = performance.now();
console.log("Setting up monorepo development environment...");

try {
  await phase("Tools", ensureTools);
  await phase("Dependencies", installDependencies);
  await phase("Build & Generate", () =>
    runDag(GROUP === undefined ? DAG_TASKS : scopedDagTasks(DAG_TASKS, GROUP)),
  );
  await phase("Verify", verifySetup);

  console.log(`\nSetup complete (${elapsed(totalStart)})`);
} catch (error) {
  console.error(`\nSetup failed (${elapsed(totalStart)})`);
  process.exit(1);
}
