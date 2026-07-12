#!/usr/bin/env bun

import { $, which } from "bun";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ShellErrorSchema = z.object({
  stderr: z.instanceof(Buffer).optional(),
  stdout: z.instanceof(Buffer).optional(),
  message: z.string().optional(),
});

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

const ROOT = import.meta.dirname
  ? path.join(import.meta.dirname, "..")
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
const SHARED_PRODUCER_DIRS = new Set([
  "packages/eslint-config",
  "packages/webring",
  "packages/llm-models",
  "packages/astro-opengraph-images",
  "packages/discord-video-stream",
  "packages/homelab/src/helm-types",
]);

// Matching DAG_TASKS ids for the same shared producers (see Phase 3 below).
const SHARED_PRODUCER_DAG_IDS = new Set([
  "eslint-config",
  "webring",
  "llm-models",
  "astro-og",
  "discord-video-stream",
  "helm-types-build",
]);

// ── Built file: producers (Phase 4 refresh derivation) ──────────────────
//
// Phase 4 (`refreshBuiltFileDependencies`) re-runs `bun install --force` in
// each consumer of a BUILT `file:` producer so the consumer's copied-in
// node_modules picks up the dist that the Phase 3 DAG produced *after* the
// Phase 2 install already copied a stale/empty version.
//
// Only producers whose *runtime-resolved* entrypoint lands in their `dist/`
// need this. The distinction (verified against each producer's package.json
// `exports`):
//
//   BUILT (default/main export → dist, DAG builds it → consumers need refresh):
//     - @shepherdjerred/llm-models   (exports "." default → ./dist/index.js)
//     - webring                      (exports "." default → ./dist/index.js)
//     - astro-opengraph-images       (exports "." default → ./dist/index.js)
//
//   SOURCE-ONLY (default export → src, so consumers import TS directly and a
//   stale dist can't affect them — NO refresh needed even though some have a
//   `tsc` build for typechecking):
//     - @shepherdjerred/eslint-config       (Bun condition → ./src/index.ts; dist only for Node `import`)
//     - @shepherdjerred/discord-video-stream (default → ./src/index.ts; only d.ts built)
//     - @shepherdjerred/helm-types          (consumed only via its CLI by the non-setup generate-helm-types script)
//     - @shepherdjerred/home-assistant      (exports "." → ./src/index.ts)
//     - @shepherdjerred/llm-observability   (exports → ./src/*.ts, no build)
//     - @shepherdjerred/discord-stream-lifecycle (exports → ./src/*.ts, no build)
//     - tasknotes-types                     (exports "." → ./src/index.ts, no build)
//
// The consumer list is derived at runtime by scanning workspace package.json
// files for `file:` deps on a BUILT_PRODUCERS member (see deriveRefreshPlan),
// so adding/removing a consumer of one of these packages no longer requires
// editing this file. If a NEW built producer with a dist-resolving default
// export is added, add its package name here.
const BUILT_PRODUCERS = new Set([
  "@shepherdjerred/llm-models",
  "webring",
  "astro-opengraph-images",
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

function isRelevantForGroup(relDir: string, group: string): boolean {
  if (SHARED_PRODUCER_DIRS.has(relDir)) return true;
  const groupDirs = PACKAGE_GROUPS[group] ?? [];
  return groupDirs.some((g) => relDir === g || relDir.startsWith(`${g}/`));
}

function isGroupOwnDir(relDir: string, group: string): boolean {
  const groupDirs = PACKAGE_GROUPS[group] ?? [];
  return groupDirs.some((g) => relDir === g || relDir.startsWith(`${g}/`));
}

function parseArgs(): {
  group: string | undefined;
  link: boolean;
  printRefreshPlan: boolean;
} {
  let group: string | undefined;
  let link = false;
  let printRefreshPlan = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--link") {
      link = true;
    } else if (arg === "--print-refresh-plan") {
      printRefreshPlan = true;
    } else if (arg.startsWith("--group=")) {
      group = arg.slice("--group=".length);
    } else {
      throw new Error(
        `Unknown argument "${arg}". Valid flags: --group=<name>, --link, ` +
          `--print-refresh-plan`,
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
  return { group, link, printRefreshPlan };
}

const {
  group: GROUP,
  link: LINK,
  printRefreshPlan: PRINT_REFRESH_PLAN,
} = parseArgs();

// ── Utilities ──────────────────────────────────────────────────────────

function elapsed(startMs: number): string {
  return `${((performance.now() - startMs) / 1000).toFixed(1)}s`;
}

function log(phaseName: string, msg: string): void {
  console.log(`  [${phaseName}] ${msg}`);
}

function warn(phaseName: string, msg: string): void {
  console.warn(`  [${phaseName}] ⚠ ${msg}`);
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
    const shellErr = ShellErrorSchema.safeParse(error).data ?? {};
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

// Extract a human-readable detail from a thrown shell/command error without
// using a type assertion (Bun's $ throws a ShellError carrying stderr/stdout).
function shellErrorDetail(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    if ("stderr" in error && error.stderr instanceof Buffer) {
      const s = error.stderr.toString().trim();
      if (s) return s;
    }
    if ("stdout" in error && error.stdout instanceof Buffer) {
      const s = error.stdout.toString().trim();
      if (s) return s;
    }
  }
  if (error instanceof Error) return error.message;
  return undefined;
}

async function findLockfileDirs(): Promise<string[]> {
  const dirs: string[] = [];
  const skip = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    "target",
    "archive",
    ".dagger",
    "poc",
    "practice",
  ]);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (await pathExists(path.join(fullPath, "bun.lock"))) {
          dirs.push(fullPath);
        }
        await walk(fullPath);
      }
    }
  }

  await walk(ROOT);
  return dirs.filter((d) => d !== ROOT).sort();
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
      const fullPath = path.join(dir, entry.name);
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
    await exec("Tools", `mise trust ${path.relative(ROOT, cfg)}`, [
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

  const optionalTools: {
    name: string;
    reason: string;
    macOnly?: boolean;
  }[] = [
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
  await exec("Deps", "root bun install", [
    "bun",
    "install",
    "--frozen-lockfile",
  ]);

  const allLockfileDirs = await findLockfileDirs();
  const lockfileDirs =
    GROUP === undefined
      ? allLockfileDirs
      : allLockfileDirs.filter((dir) =>
          isRelevantForGroup(path.relative(ROOT, dir), GROUP),
        );
  log(
    "Deps",
    GROUP === undefined
      ? `Found ${String(lockfileDirs.length)} packages with bun.lock`
      : `Found ${String(lockfileDirs.length)}/${String(allLockfileDirs.length)} packages with bun.lock in scope for --group=${GROUP}`,
  );

  const concurrency = 6;
  const maxAttempts = 3;
  const failures: { dir: string; error: unknown }[] = [];
  let completed = 0;

  async function installOne(dir: string): Promise<void> {
    const label = path.relative(ROOT, dir);
    const useLink = LINK && GROUP !== undefined && isGroupOwnDir(label, GROUP);
    const cmd = useLink
      ? ["bun", "install", "--frozen-lockfile", "--backend=symlink"]
      : ["bun", "install", "--frozen-lockfile"];
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await $`${cmd}`.cwd(dir).quiet();
        completed++;
        return;
      } catch (error) {
        lastError = error;
        // Concurrent installs occasionally contend on the shared bun cache;
        // back off briefly and retry before giving up (individual installs
        // succeed in seconds when not racing each other).
        if (attempt < maxAttempts) await Bun.sleep(attempt * 250);
      }
    }
    failures.push({ dir: label, error: lastError });
  }

  for (let i = 0; i < lockfileDirs.length; i += concurrency) {
    const batch = lockfileDirs.slice(i, i + concurrency);
    await Promise.allSettled(batch.map((dir) => installOne(dir)));
  }

  log(
    "Deps",
    `Installed ${String(completed)}/${String(lockfileDirs.length)} packages`,
  );

  if (failures.length > 0) {
    console.error(`  [Deps] ${String(failures.length)} package(s) failed:`);
    for (const f of failures) {
      console.error(`           - ${f.dir}`);
      const detail = shellErrorDetail(f.error);
      if (detail) {
        for (const line of detail.split("\n")) {
          console.error(`             ${line}`);
        }
      }
    }
    throw new Error("Dependency installation failed");
  }

  // homelab's nested pseudo-workspaces (src/helm-types, src/cdk8s) aren't
  // shared producers other groups need, so skip this in scoped mode.
  if (GROUP === undefined) {
    const homelabDir = path.join(ROOT, "packages", "homelab");
    if (await pathExists(homelabDir)) {
      await exec(
        "Deps",
        "homelab install-subpkgs",
        ["bun", "run", "install-subpkgs"],
        { cwd: homelabDir },
      );
    }
  }
}

// A consumer directory that needs a Phase 4 `--force` refresh, plus which
// BUILT_PRODUCERS members triggered it (for a legible drift-visible log).
type RefreshEntry = { cwd: string; producers: string[] };

const RefreshPackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
});

// sjer.red is refreshed regardless of --group: it's the one consumer whose
// `--force` install is deliberately unconditional (webring/astro-og dist
// gating was left as a deferred decision — see the 2026-06-13 setup cost-
// profiling log). Every other consumer is gated by group scope.
const ALWAYS_REFRESH_DIRS = new Set(["packages/sjer.red"]);

// Scan every workspace package.json for `file:` deps resolving to a
// BUILT_PRODUCERS member; the consumers found are exactly the dirs whose
// copied-in dist must be refreshed after the Phase 3 build. Fails fast on an
// unreadable/invalid package.json rather than silently under-refreshing.
async function deriveRefreshPlan(): Promise<RefreshEntry[]> {
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
  const packagesRoot = path.join(ROOT, "packages");
  const found: RefreshEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(fullPath);
      } else if (entry.name === "package.json") {
        const relDir = path.relative(ROOT, dir);
        let parsed: z.infer<typeof RefreshPackageJsonSchema>;
        try {
          parsed = RefreshPackageJsonSchema.parse(
            JSON.parse(await readFile(fullPath, "utf8")),
          );
        } catch (error) {
          const detail = shellErrorDetail(error) ?? "unknown error";
          throw new Error(
            `Failed to read/parse ${path.relative(ROOT, fullPath)}: ${detail}`,
            { cause: error },
          );
        }
        const allDeps = {
          ...parsed.dependencies,
          ...parsed.devDependencies,
          ...parsed.optionalDependencies,
        };
        const producers = Object.entries(allDeps)
          .filter(
            ([name, spec]) =>
              BUILT_PRODUCERS.has(name) && spec.startsWith("file:"),
          )
          .map(([name]) => name)
          .sort();
        if (producers.length > 0) {
          found.push({ cwd: relDir, producers });
        }
      }
    }
  }

  await walk(packagesRoot);
  return found.sort((a, b) => a.cwd.localeCompare(b.cwd));
}

// Apply --group scoping: sjer.red is always kept; everything else must be in
// the group's scope (its own dirs or the shared producers). No group = keep
// all. Mirrors the pre-derivation carve-out (sjer.red unconditional).
function scopeRefreshPlan(plan: RefreshEntry[]): RefreshEntry[] {
  if (GROUP === undefined) return plan;
  return plan.filter(
    (e) => ALWAYS_REFRESH_DIRS.has(e.cwd) || isRelevantForGroup(e.cwd, GROUP),
  );
}

function logRefreshPlan(plan: RefreshEntry[]): void {
  const scope = GROUP === undefined ? "full run" : `--group=${GROUP}`;
  log(
    "Deps",
    `Derived Phase 4 refresh plan (${scope}): ${String(plan.length)} consumer(s) of built file: producers`,
  );
  for (const entry of plan) {
    log("Deps", `  ${entry.cwd}  ← ${entry.producers.join(", ")}`);
  }
  if (plan.length === 0) {
    log("Deps", "  (none in scope)");
  }
}

async function refreshBuiltFileDependencies(): Promise<void> {
  const refreshDirs = scopeRefreshPlan(await deriveRefreshPlan());
  logRefreshPlan(refreshDirs);

  for (const dir of refreshDirs) {
    const label = `${dir.cwd} refresh (${dir.producers.join(", ")})`;
    const fullCwd = path.join(ROOT, dir.cwd);
    if (!(await pathExists(fullCwd))) {
      warn("Deps", `${label} skipped (directory not found)`);
      continue;
    }

    // Without this, a `--link` group's symlinked node_modules gets silently
    // materialized back to real files here: this refresh dir can be a
    // workspace member with no bun.lock of its own (e.g. discord-plays-pokemon's
    // backend), in which case `bun install` operates on the shared workspace
    // root — so a bare `--force` (no --backend) re-links the whole workspace
    // with the default backend, undoing Phase 2's symlink install.
    const useLink =
      LINK && GROUP !== undefined && isGroupOwnDir(dir.cwd, GROUP);
    const cmd = useLink
      ? ["bun", "install", "--force", "--backend=symlink"]
      : ["bun", "install", "--force"];

    await exec("Deps", label, cmd, { cwd: fullCwd });
  }
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

async function runDag(tasks: DagTask[], maxConcurrency = 4): Promise<void> {
  // Filter to tasks whose directories exist
  const valid: DagTask[] = [];
  for (const t of tasks) {
    const fullCwd = path.join(ROOT, t.cwd);
    if (!(await pathExists(fullCwd))) {
      warn("DAG", `${t.label} skipped (directory not found)`);
      continue;
    }
    valid.push(t);
  }

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
        const promise = (async (): Promise<string> => {
          try {
            const ok = await exec("DAG", task.label, task.cmd, {
              cwd: path.join(ROOT, task.cwd),
              warnOnly: task.warnOnly,
            });
            if (!ok) failed.add(id);
          } catch {
            failed.add(id);
          }
          return id;
        })();
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
  const checks: { label: string; path: string; group?: string }[] = [
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
    const fullPath = path.join(ROOT, check.path);
    if (await pathExists(fullPath)) {
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

// Dry-run: derive and print the Phase 4 refresh plan, then exit without
// installing anything. Lets a reviewer see exactly which consumers the
// derivation picks (and which built producer triggered each) at zero cost.
if (PRINT_REFRESH_PLAN) {
  const plan = scopeRefreshPlan(await deriveRefreshPlan());
  logRefreshPlan(plan);
  process.exit(0);
}

const totalStart = performance.now();
console.log("Setting up monorepo development environment...");

try {
  await phase("Tools", ensureTools);
  await phase("Dependencies", installDependencies);
  await phase("Build & Generate", () =>
    runDag(GROUP === undefined ? DAG_TASKS : scopedDagTasks(DAG_TASKS, GROUP)),
  );
  await phase("Refresh Built Dependencies", refreshBuiltFileDependencies);
  await phase("Verify", verifySetup);

  console.log(`\nSetup complete (${elapsed(totalStart)})`);
} catch {
  console.error(`\nSetup failed (${elapsed(totalStart)})`);
  process.exit(1);
}
