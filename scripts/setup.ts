#!/usr/bin/env bun

import { $, which } from "bun";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = import.meta.dirname
  ? join(import.meta.dirname, "..")
  : process.cwd();

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
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (existsSync(join(fullPath, "bun.lock"))) {
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
  await exec("Deps", "root bun install", [
    "bun",
    "install",
    "--frozen-lockfile",
  ]);

  const lockfileDirs = await findLockfileDirs();
  log("Deps", `Found ${String(lockfileDirs.length)} packages with bun.lock`);

  const concurrency = 6;
  const maxAttempts = 3;
  const failures: Array<{ dir: string; error: unknown }> = [];
  let completed = 0;

  async function installOne(dir: string): Promise<void> {
    const label = relative(ROOT, dir);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await $`bun install --frozen-lockfile`.cwd(dir).quiet();
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

  const homelabDir = join(ROOT, "packages", "homelab");
  if (existsSync(homelabDir)) {
    await exec(
      "Deps",
      "homelab install-subpkgs",
      ["bun", "run", "install-subpkgs"],
      { cwd: homelabDir },
    );
  }
}

async function refreshBuiltFileDependencies(): Promise<void> {
  const refreshDirs: Array<{ label: string; cwd: string }> = [
    {
      label: "sjer.red local package artifacts",
      cwd: "packages/sjer.red",
    },
  ];

  for (const dir of refreshDirs) {
    const fullCwd = join(ROOT, dir.cwd);
    if (!existsSync(fullCwd)) {
      warn("Deps", `${dir.label} skipped (directory not found)`);
      continue;
    }

    await exec("Deps", `${dir.label} refresh`, ["bun", "install", "--force"], {
      cwd: fullCwd,
    });
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
    id: "scout-generate",
    label: "scout-for-lol generate",
    cmd: ["bun", "run", "generate"],
    cwd: "packages/scout-for-lol",
    deps: ["birmel-prisma"],
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
  const checks: Array<{ label: string; path: string }> = [
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
      path: "packages/birmel/node_modules/.prisma/client",
    },
    {
      label: "scout-for-lol prisma client",
      path: "packages/scout-for-lol/packages/backend/generated/prisma/client",
    },
    {
      label: "discord-plays-mario-kart prisma client",
      path: "packages/discord-plays-mario-kart/packages/backend/generated/prisma/client",
    },
  ];

  let passed = 0;
  for (const check of checks) {
    const fullPath = join(ROOT, check.path);
    if (existsSync(fullPath)) {
      passed++;
    } else {
      warn("Verify", `${check.label} not found at ${check.path}`);
    }
  }

  log("Verify", `${String(passed)}/${String(checks.length)} artifacts present`);
}

// ── Main ───────────────────────────────────────────────────────────────

const totalStart = performance.now();
console.log("Setting up monorepo development environment...");

try {
  await phase("Tools", ensureTools);
  await phase("Dependencies", installDependencies);
  await phase("Build & Generate", () => runDag(DAG_TASKS));
  await phase("Refresh Built Dependencies", refreshBuiltFileDependencies);
  await phase("Verify", verifySetup);

  console.log(`\nSetup complete (${elapsed(totalStart)})`);
} catch (error) {
  console.error(`\nSetup failed (${elapsed(totalStart)})`);
  process.exit(1);
}
