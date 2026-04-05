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
    if (error instanceof Error) {
      console.error(`  ${error.message.split("\n").slice(0, 5).join("\n  ")}`);
    }
    throw error;
  }
}

function hasTool(name: string): boolean {
  return which(name) !== null;
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
  // Exclude root itself (handled separately)
  return dirs.filter((d) => d !== ROOT).sort();
}

// ── Phase 1: Tools ───────────���─────────────────────────────────────────

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

async function ensureTools(): Promise<void> {
  // Trust all mise configs in the repo
  const miseConfigs = await findMiseConfigs();
  log("Tools", `Found ${String(miseConfigs.length)} mise config files`);
  await Promise.all(
    miseConfigs.map((cfg) => $`mise trust ${cfg}`.quiet().catch(() => {})),
  );
  log("Tools", "Trusted all mise configs");

  // Install tools from all configs
  await exec("Tools", "mise install", ["mise", "install"]);

  const isMac = process.platform === "darwin";

  const optionalTools: Array<{
    name: string;
    reason: string;
    macOnly?: boolean;
  }> = [
    { name: "helm", reason: "homelab helm-types generation" },
    { name: "swift", reason: "tips/glance macOS apps", macOnly: true },
    { name: "swiftlint", reason: "Swift linting (pre-commit)", macOnly: true },
    {
      name: "swiftformat",
      reason: "Swift formatting (pre-commit)",
      macOnly: true,
    },
    { name: "typeshare", reason: "clauderon Rust↔TS type sharing" },
    { name: "go", reason: "terraform-provider-asuswrt" },
    { name: "golangci-lint", reason: "Go linting (pre-commit)" },
    { name: "mvn", reason: "castle-casters (Java game)" },
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

// ── Phase 2: Dependencies ─────────��────────────────────────────────────

async function installDependencies(): Promise<void> {
  // Root install first (gets markdownlint-cli2, triggers lefthook via prepare)
  await exec("Deps", "root bun install", ["bun", "install"]);

  // Find all per-package lockfile directories
  const lockfileDirs = await findLockfileDirs();
  log("Deps", `Found ${String(lockfileDirs.length)} packages with bun.lock`);

  // Install in parallel with concurrency limit
  const concurrency = 6;
  const failures: Array<{ dir: string; error: unknown }> = [];
  let completed = 0;

  async function installOne(dir: string): Promise<void> {
    const label = relative(ROOT, dir);
    try {
      await $`bun install`.cwd(dir).quiet();
      completed++;
    } catch (error) {
      failures.push({ dir: label, error });
    }
  }

  // Process in batches
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
    }
    throw new Error("Dependency installation failed");
  }

  // Homelab sub-packages (uses frozen-lockfile internally)
  const homelabDir = join(ROOT, "packages", "homelab");
  if (existsSync(homelabDir)) {
    await exec(
      "Deps",
      "homelab install-subpkgs",
      ["bun", "run", "install-subpkgs"],
      {
        cwd: homelabDir,
      },
    );
  }
}

// ── Phase 3: Build Shared Packages ���─────────────────��──────────────────

async function buildSharedPackages(): Promise<void> {
  // Tier 1: eslint-config (depended on by nearly everything)
  await exec("Build", "eslint-config", ["bun", "run", "build"], {
    cwd: join(ROOT, "packages", "eslint-config"),
  });

  // Tier 2: parallel (depend only on eslint-config or nothing)
  const tier2 = [
    { label: "webring", cwd: join(ROOT, "packages", "webring") },
    {
      label: "astro-opengraph-images",
      cwd: join(ROOT, "packages", "astro-opengraph-images"),
    },
    {
      label: "homelab/helm-types",
      cwd: join(ROOT, "packages", "homelab", "src", "helm-types"),
    },
  ];

  const tier2Results = await Promise.allSettled(
    tier2.map((t) =>
      exec("Build", t.label, ["bun", "run", "build"], { cwd: t.cwd }),
    ),
  );

  for (const result of tier2Results) {
    if (result.status === "rejected") {
      throw result.reason instanceof Error
        ? result.reason
        : new Error(String(result.reason));
    }
  }

  // Tier 3: clauderon web packages (sequential — client depends on shared)
  const clauderonWeb = join(ROOT, "packages", "clauderon", "web");
  if (existsSync(clauderonWeb)) {
    await exec("Build", "clauderon/web/shared", ["bun", "run", "build"], {
      cwd: join(clauderonWeb, "shared"),
    });
    await exec("Build", "clauderon/web/client", ["bun", "run", "build"], {
      cwd: join(clauderonWeb, "client"),
    });
  }
}

// ── Phase 4: Code Generation ─────────────��─────────────────────────────

async function runCodeGeneration(): Promise<void> {
  const generators: Array<{
    label: string;
    cmd: string[];
    cwd: string;
    warnOnly: boolean;
  }> = [
    {
      label: "birmel prisma",
      cmd: ["bunx", "--trust", "prisma@6", "generate"],
      cwd: join(ROOT, "packages", "birmel"),
      warnOnly: false,
    },
    {
      label: "scout-for-lol generate",
      cmd: ["bun", "run", "generate"],
      cwd: join(ROOT, "packages", "scout-for-lol"),
      warnOnly: false,
    },
    {
      label: "homelab helm-types codegen",
      cmd: ["bun", "run", "generate-helm-types"],
      cwd: join(ROOT, "packages", "homelab", "src", "cdk8s"),
      warnOnly: true,
    },
    {
      label: "homelab HA types",
      cmd: ["bun", "run", "generate-types"],
      cwd: join(ROOT, "packages", "homelab", "src", "ha"),
      warnOnly: true,
    },
  ];

  // Filter out generators whose directories don't exist
  const valid = generators.filter((g) => {
    if (!existsSync(g.cwd)) {
      warn("Codegen", `${g.label} skipped (directory not found)`);
      return false;
    }
    return true;
  });

  const results = await Promise.allSettled(
    valid.map((g) =>
      exec("Codegen", g.label, g.cmd, { cwd: g.cwd, warnOnly: g.warnOnly }),
    ),
  );

  // Re-throw any fatal failures
  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason instanceof Error
        ? result.reason
        : new Error(String(result.reason));
    }
  }
}

// ── Phase 5: Verify ─────────────────────────────────────────���──────────

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
      label: "helm-types dist",
      path: "packages/homelab/src/helm-types/dist/cli.js",
    },
    {
      label: "clauderon/web/shared dist",
      path: "packages/clauderon/web/shared/dist",
    },
    {
      label: "clauderon/web/client dist",
      path: "packages/clauderon/web/client/dist",
    },
    {
      label: "birmel prisma client",
      path: "packages/birmel/node_modules/.prisma/client",
    },
    {
      label: "scout-for-lol prisma client",
      path: "packages/scout-for-lol/packages/backend/generated/prisma/client",
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

// ── Main ──────────────���────────────────────────���───────────────────────

const totalStart = performance.now();
console.log("Setting up monorepo development environment...");

try {
  await phase("Tools", ensureTools);
  await phase("Dependencies", installDependencies);
  await phase("Shared Packages", buildSharedPackages);
  await phase("Code Generation", runCodeGeneration);
  await phase("Verify", verifySetup);

  console.log(`\nSetup complete (${elapsed(totalStart)})`);
} catch (error) {
  console.error(`\nSetup failed (${elapsed(totalStart)})`);
  process.exit(1);
}
