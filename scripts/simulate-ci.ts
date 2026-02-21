#!/usr/bin/env bun
/**
 * Dagger CI Pipeline Simulator
 *
 * Models the CI pipeline as a DAG and simulates execution with
 * content-addressed caching to identify bottlenecks and optimization
 * opportunities.
 *
 * Usage:
 *   bun scripts/simulate-ci.ts                                          # versions.ts change
 *   bun scripts/simulate-ci.ts packages/birmel/src/index.ts             # specific file
 *   bun scripts/simulate-ci.ts --preset lockfile                        # preset scenario
 *   bun scripts/simulate-ci.ts --release packages/homelab/src/...       # with release phase
 *   bun scripts/simulate-ci.ts --all                                    # full rebuild
 *   bun scripts/simulate-ci.ts --list-presets                           # show available presets
 */

// ─── Types ───────────────────────────────────────────────────────────────────

type Node = {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /**
   * File path prefixes this node reads from source.
   * A node's cache is invalidated if any changed file starts with any prefix.
   * Use "*" for full-source dependency (any change invalidates).
   */
  inputs: string[];
  /** IDs of nodes this depends on (output feeds into this node → cache cascade) */
  dependsOn: string[];
  /** Estimated duration in seconds when NOT cached */
  duration: number;
  /** Only runs on release (main branch) builds */
  releaseOnly?: boolean;
};

type CacheStatus = {
  cached: boolean;
  reason?: "direct" | "cascade";
  /** Which input prefix matched (for direct invalidation) */
  matchedInput?: string;
  /** Which dependency caused cascade */
  cascadeFrom?: string;
};

type SimResult = {
  id: string;
  name: string;
  cached: boolean;
  reason?: "direct" | "cascade";
  matchedInput?: string;
  cascadeFrom?: string;
  startTime: number;
  endTime: number;
  duration: number;
};

// ─── Pipeline Definition ─────────────────────────────────────────────────────
//
// Models the actual Dagger CI pipeline from .dagger/src/index.ts.
// Each node represents a Dagger operation or group of operations.
// `inputs` reflect which source.directory() or source.file() calls the node makes.
// `dependsOn` reflects which node outputs feed into this node's container state.

const PIPELINE: Node[] = [
  // ════════════════════════════════════════════════════════════════════════════
  // TIER 0: Fire-and-forget at t=0 (independent of main pipeline)
  // ════════════════════════════════════════════════════════════════════════════

  // Mounts full source → invalidated by ANY change
  {
    id: "compliance",
    name: "Compliance check",
    inputs: ["*"],
    dependsOn: [],
    duration: 5,
  },

  // Shared eslint-config build (used by many package checks)
  // Uses source.directory("packages/eslint-config") + source.file("tsconfig.base.json")
  {
    id: "eslint-config-build",
    name: "Build eslint-config",
    inputs: ["packages/eslint-config/", "tsconfig.base.json"],
    dependsOn: [],
    duration: 8,
  },

  // Quality & security checks — all mount full source
  {
    id: "quality-ratchet",
    name: "Quality ratchet",
    inputs: ["*"],
    dependsOn: [],
    duration: 10,
  },
  {
    id: "shellcheck",
    name: "Shellcheck",
    inputs: ["*"],
    dependsOn: [],
    duration: 5,
  },
  {
    id: "actionlint",
    name: "Actionlint",
    inputs: ["*"],
    dependsOn: [],
    duration: 5,
  },
  {
    id: "trivy",
    name: "Trivy scan",
    inputs: ["*"],
    dependsOn: [],
    duration: 30,
  },
  {
    id: "semgrep",
    name: "Semgrep scan",
    inputs: ["*"],
    dependsOn: [],
    duration: 45,
  },
  {
    id: "dagger-lint",
    name: "Dagger ESLint",
    inputs: [".dagger/", "packages/eslint-config/", "tsconfig.base.json"],
    dependsOn: ["eslint-config-build"],
    duration: 10,
  },

  // Mobile CI — extracts specific subdirectories
  {
    id: "mobile-ci",
    name: "Mobile CI",
    inputs: [
      "packages/clauderon/mobile/",
      "packages/clauderon/web/shared/src/generated/",
      "tsconfig.base.json",
    ],
    dependsOn: [],
    duration: 15,
  },

  // Birmel validation — builds its own workspace container + image + smoke test
  {
    id: "birmel-validation",
    name: "Birmel validation",
    inputs: [
      "packages/birmel/",
      "packages/eslint-config/",
      "tsconfig.base.json",
      "package.json",
      "bun.lock",
    ],
    dependsOn: ["eslint-config-build"],
    duration: 60,
  },

  // ── Per-package checks (within packageValidation, parallel) ──

  {
    id: "check-astro-og",
    name: "Check astro-opengraph-images",
    inputs: [
      "packages/astro-opengraph-images/",
      "tsconfig.base.json",
      "package.json",
      "bun.lock",
    ],
    dependsOn: ["eslint-config-build"],
    duration: 12,
  },
  {
    id: "check-webring",
    name: "Check webring",
    inputs: [
      "packages/webring/",
      "tsconfig.base.json",
      "package.json",
      "bun.lock",
    ],
    dependsOn: ["eslint-config-build"],
    duration: 10,
  },
  {
    id: "check-starlight-karma",
    name: "Check starlight-karma-bot",
    inputs: ["packages/starlight-karma-bot/", "package.json", "bun.lock"],
    dependsOn: [],
    duration: 10,
  },
  {
    id: "check-better-skill-capped",
    name: "Check better-skill-capped",
    inputs: [
      "packages/better-skill-capped/",
      "tsconfig.base.json",
      "package.json",
      "bun.lock",
    ],
    dependsOn: ["eslint-config-build"],
    duration: 15,
  },
  {
    id: "check-sjer-red",
    name: "Check sjer.red",
    inputs: [
      "packages/sjer.red/",
      "packages/webring/",
      "tsconfig.base.json",
      "package.json",
      "bun.lock",
    ],
    dependsOn: [],
    duration: 30,
  },
  {
    id: "check-dpp",
    name: "Check discord-plays-pokemon",
    inputs: [
      "packages/discord-plays-pokemon/",
      "tsconfig.base.json",
      "package.json",
      "bun.lock",
    ],
    dependsOn: ["eslint-config-build"],
    duration: 20,
  },
  {
    id: "check-castle-casters",
    name: "Check castle-casters",
    inputs: ["packages/castle-casters/"],
    dependsOn: [],
    duration: 10,
  },
  {
    id: "check-homelab",
    name: "Check homelab",
    inputs: [
      "packages/homelab/",
      "packages/eslint-config/",
      "tsconfig.base.json",
    ],
    dependsOn: ["eslint-config-build"],
    duration: 30,
  },
  // Runs sequentially after main checks in the actual pipeline
  {
    id: "check-scout-for-lol",
    name: "Check scout-for-lol",
    inputs: [
      "packages/scout-for-lol/",
      "packages/eslint-config/",
      "tsconfig.base.json",
      "package.json",
      "bun.lock",
    ],
    dependsOn: [
      "eslint-config-build",
      // In the actual code, scout-for-lol runs after the main parallel batch
      "check-astro-og",
      "check-webring",
      "check-starlight-karma",
      "check-better-skill-capped",
      "check-sjer-red",
      "check-dpp",
      "check-castle-casters",
      "check-homelab",
    ],
    duration: 45,
  },
  {
    id: "check-macos-cross-compiler",
    name: "Check macos-cross-compiler",
    inputs: ["packages/macos-cross-compiler/"],
    dependsOn: [],
    duration: 120,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 1: Critical path — bun install + TypeShare in parallel
  // ════════════════════════════════════════════════════════════════════════════

  // TypeShare: getRustContainer mounts source.directory("packages/clauderon")
  {
    id: "typeshare",
    name: "TypeShare generation",
    inputs: ["packages/clauderon/"],
    dependsOn: [],
    duration: 30,
  },

  // installWorkspaceDeps PHASE 1+2: copy lockfiles + package.jsons → bun install
  // Cached if lockfile and package.json files unchanged
  {
    id: "bun-install-deps",
    name: "Bun install (deps)",
    inputs: [
      "package.json",
      "bun.lock",
      // Each workspace's package.json
      "packages/birmel/package.json",
      "packages/bun-decompile/package.json",
      "packages/eslint-config/package.json",
      "packages/resume/package.json",
      "packages/tools/package.json",
      "packages/clauderon/web/package.json",
      "packages/clauderon/web/bun.lock",
      "packages/clauderon/web/shared/package.json",
      "packages/clauderon/web/client/package.json",
      "packages/clauderon/web/frontend/package.json",
      "packages/clauderon/docs/",
      "packages/astro-opengraph-images/package.json",
      "packages/better-skill-capped/package.json",
      "packages/better-skill-capped/fetcher/package.json",
      "packages/sjer.red/package.json",
      "packages/webring/package.json",
      "packages/starlight-karma-bot/package.json",
      "packages/homelab/package.json",
      "packages/homelab/src/cdk8s/package.json",
      "packages/homelab/src/deps-email/package.json",
      "packages/homelab/src/ha/package.json",
      "packages/homelab/src/helm-types/package.json",
      "packages/discord-plays-pokemon/package.json",
      "packages/discord-plays-pokemon/packages/backend/package.json",
      "packages/discord-plays-pokemon/packages/common/package.json",
      "packages/discord-plays-pokemon/packages/frontend/package.json",
      "packages/scout-for-lol/package.json",
      "packages/scout-for-lol/packages/backend/package.json",
      "packages/scout-for-lol/packages/data/package.json",
      "packages/scout-for-lol/packages/desktop/package.json",
      "packages/scout-for-lol/packages/frontend/package.json",
      "packages/scout-for-lol/packages/report/package.json",
      "packages/scout-for-lol/packages/ui/package.json",
    ],
    dependsOn: [],
    duration: 25,
  },

  // installWorkspaceDeps PHASE 3+4: mount source dirs → bun install again
  // Invalidated if ANY workspace source changes (sequential mount chain)
  {
    id: "bun-install-source",
    name: "Bun install (source mount)",
    inputs: [
      "tsconfig.base.json",
      "scripts/",
      "packages/birmel/",
      "packages/bun-decompile/",
      "packages/eslint-config/",
      "packages/tools/",
      "packages/clauderon/web/",
      "packages/clauderon/docs/",
      "packages/astro-opengraph-images/",
      "packages/better-skill-capped/",
      "packages/sjer.red/",
      "packages/webring/",
      "packages/starlight-karma-bot/",
      "packages/homelab/",
      "packages/discord-plays-pokemon/",
      "packages/scout-for-lol/",
    ],
    dependsOn: ["bun-install-deps"],
    duration: 5,
  },

  // Prisma setup: generate + push for birmel and scout-for-lol
  {
    id: "prisma",
    name: "Prisma setup",
    inputs: [
      "packages/birmel/prisma/",
      "packages/scout-for-lol/packages/backend/prisma/",
    ],
    dependsOn: ["bun-install-source"],
    duration: 10,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // Between Tier 1 and 2: Clauderon web build
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: "web-build",
    name: "Clauderon web build",
    inputs: ["packages/clauderon/web/"],
    dependsOn: ["typeshare", "prisma"],
    duration: 20,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 2: Clauderon Rust CI + monorepo build in parallel
  // ════════════════════════════════════════════════════════════════════════════

  // Rust CI: uses getRustContainer(source) which mounts source.directory("packages/clauderon")
  // Also needs webResult.frontendDist
  {
    id: "clauderon-rust-ci",
    name: "Clauderon Rust CI",
    inputs: ["packages/clauderon/"],
    dependsOn: ["web-build"],
    duration: 120,
  },

  // Monorepo build: uses the shared container from prisma setup
  {
    id: "monorepo-build",
    name: "Monorepo build",
    inputs: [],
    dependsOn: ["prisma"],
    duration: 45,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // TIER 3: Knip + collect tier 0
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: "knip",
    name: "Knip check",
    inputs: [],
    dependsOn: ["monorepo-build"],
    duration: 20,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // Release phase (main branch only)
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: "release-please-pr",
    name: "Release Please PR",
    inputs: [],
    dependsOn: ["knip"],
    duration: 15,
    releaseOnly: true,
  },
  {
    id: "release-please-release",
    name: "Release Please Release",
    inputs: [],
    dependsOn: ["release-please-pr"],
    duration: 10,
    releaseOnly: true,
  },
  {
    id: "npm-publish",
    name: "NPM publish",
    inputs: [],
    dependsOn: ["release-please-release"],
    duration: 10,
    releaseOnly: true,
  },
  {
    id: "deploy-birmel",
    name: "Deploy birmel image",
    inputs: [],
    dependsOn: ["knip", "birmel-validation"],
    duration: 30,
    releaseOnly: true,
  },
  {
    id: "deploy-scout",
    name: "Deploy scout-for-lol images",
    inputs: [],
    dependsOn: ["knip"],
    duration: 45,
    releaseOnly: true,
  },
  {
    id: "deploy-mux-site",
    name: "Deploy mux site",
    inputs: [],
    dependsOn: ["knip"],
    duration: 20,
    releaseOnly: true,
  },
  {
    id: "deploy-resume",
    name: "Deploy resume",
    inputs: [],
    dependsOn: ["knip"],
    duration: 20,
    releaseOnly: true,
  },
  {
    id: "homelab-release",
    name: "Homelab release (helm + argocd)",
    inputs: ["packages/homelab/"],
    dependsOn: ["deploy-birmel", "deploy-scout"],
    duration: 30,
    releaseOnly: true,
  },
  {
    id: "clauderon-release",
    name: "Clauderon binary release",
    inputs: ["packages/clauderon/"],
    dependsOn: ["release-please-release", "clauderon-rust-ci"],
    duration: 120,
    releaseOnly: true,
  },
  {
    id: "version-commit-back",
    name: "Version commit-back",
    inputs: [],
    dependsOn: [
      "homelab-release",
      "clauderon-release",
      "npm-publish",
      "deploy-mux-site",
      "deploy-resume",
    ],
    duration: 10,
    releaseOnly: true,
  },
];

// ─── Presets ──────────────────────────────────────────────────────────────────

const PRESETS: Record<string, { description: string; files: string[] }> = {
  "versions-ts": {
    description: "Change only homelab versions.ts (image version update)",
    files: ["packages/homelab/src/cdk8s/src/versions.ts"],
  },
  lockfile: {
    description: "Change bun.lock (dependency update)",
    files: ["bun.lock"],
  },
  "eslint-config": {
    description: "Change shared ESLint config",
    files: ["packages/eslint-config/src/index.ts"],
  },
  birmel: {
    description: "Change birmel source only",
    files: ["packages/birmel/src/index.ts"],
  },
  clauderon: {
    description: "Change clauderon Rust source",
    files: ["packages/clauderon/src/main.rs"],
  },
  "dagger-only": {
    description: "Change only Dagger CI config",
    files: [".dagger/src/index.ts"],
  },
  readme: {
    description: "Change only the README",
    files: ["README.md"],
  },
  "scout-homelab": {
    description: "Change scout-for-lol + homelab (two packages)",
    files: [
      "packages/scout-for-lol/packages/backend/src/index.ts",
      "packages/homelab/src/cdk8s/src/versions.ts",
    ],
  },
};

// ─── Cache Analysis ──────────────────────────────────────────────────────────

function analyzeCache(
  nodes: Node[],
  changedFiles: string[],
  isRelease: boolean,
): Map<string, CacheStatus> {
  const status = new Map<string, CacheStatus>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // First pass: determine direct invalidations
  for (const node of nodes) {
    if (node.releaseOnly && !isRelease) {
      continue;
    }

    let directHit: { prefix: string; file: string } | undefined;
    for (const prefix of node.inputs) {
      if (prefix === "*") {
        if (changedFiles.length > 0) {
          directHit = { prefix: "*", file: changedFiles[0] };
          break;
        }
      } else {
        const matched = changedFiles.find((f) => f.startsWith(prefix));
        if (matched !== undefined) {
          directHit = { prefix, file: matched };
          break;
        }
      }
    }

    if (directHit !== undefined) {
      status.set(node.id, {
        cached: false,
        reason: "direct",
        matchedInput: directHit.prefix,
      });
    }
  }

  // Second pass: propagate cascades (BFS)
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.releaseOnly && !isRelease) continue;
      if (status.has(node.id)) continue;

      for (const depId of node.dependsOn) {
        const depStatus = status.get(depId);
        if (depStatus !== undefined && !depStatus.cached) {
          status.set(node.id, {
            cached: false,
            reason: "cascade",
            cascadeFrom: depId,
          });
          changed = true;
          break;
        }
      }
    }
  }

  // Remaining nodes are cached
  for (const node of nodes) {
    if (node.releaseOnly && !isRelease) continue;
    if (!status.has(node.id)) {
      status.set(node.id, { cached: true });
    }
  }

  return status;
}

// ─── Execution Simulation ────────────────────────────────────────────────────

function simulate(
  nodes: Node[],
  cacheStatus: Map<string, CacheStatus>,
  isRelease: boolean,
): SimResult[] {
  const results: SimResult[] = [];
  const completionTime = new Map<string, number>();

  // Topological sort by dependency order
  const sorted = topologicalSort(nodes, isRelease);

  for (const node of sorted) {
    const status = cacheStatus.get(node.id);
    if (status === undefined) continue;

    // Start time = max completion time of all dependencies
    let startTime = 0;
    for (const depId of node.dependsOn) {
      const depTime = completionTime.get(depId);
      if (depTime !== undefined && depTime > startTime) {
        startTime = depTime;
      }
    }

    const duration = status.cached ? 0 : node.duration;
    const endTime = startTime + duration;
    completionTime.set(node.id, endTime);

    results.push({
      id: node.id,
      name: node.name,
      cached: status.cached,
      reason: status.reason,
      matchedInput: status.matchedInput,
      cascadeFrom: status.cascadeFrom,
      startTime,
      endTime,
      duration,
    });
  }

  return results;
}

function topologicalSort(nodes: Node[], isRelease: boolean): Node[] {
  const active = nodes.filter((n) => !n.releaseOnly || isRelease);
  const visited = new Set<string>();
  const result: Node[] = [];
  const nodeMap = new Map(active.map((n) => [n.id, n]));

  function visit(node: Node) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    for (const depId of node.dependsOn) {
      const dep = nodeMap.get(depId);
      if (dep !== undefined) visit(dep);
    }
    result.push(node);
  }

  for (const node of active) visit(node);
  return result;
}

// ─── Critical Path ───────────────────────────────────────────────────────────

function findCriticalPath(results: SimResult[]): SimResult[] {
  if (results.length === 0) return [];

  const resultMap = new Map(results.map((r) => [r.id, r]));
  const nodeMap = new Map(PIPELINE.map((n) => [n.id, n]));

  // Find the node with the latest end time
  let latest = results[0];
  for (const r of results) {
    if (r.endTime > latest.endTime) latest = r;
  }

  // Trace back through the critical path
  const path: SimResult[] = [latest];
  let current = latest;

  while (true) {
    const node = nodeMap.get(current.id);
    if (node === undefined || node.dependsOn.length === 0) break;

    // Find the dependency that determined this node's start time
    let criticalDep: SimResult | undefined;
    for (const depId of node.dependsOn) {
      const dep = resultMap.get(depId);
      if (dep !== undefined) {
        if (
          criticalDep === undefined ||
          dep.endTime > criticalDep.endTime
        ) {
          criticalDep = dep;
        }
      }
    }

    if (criticalDep === undefined || criticalDep.endTime === 0) break;
    path.unshift(criticalDep);
    current = criticalDep;
  }

  return path;
}

// ─── Output Formatting ───────────────────────────────────────────────────────

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

function renderCacheAnalysis(
  results: SimResult[],
  _cacheStatus: Map<string, CacheStatus>,
): string {
  const lines: string[] = [];
  const c = COLORS;

  lines.push(`${c.bold}Cache Analysis:${c.reset}`);
  lines.push("");

  // Group by cache status
  const cached = results.filter((r) => r.cached);
  const directMiss = results.filter(
    (r) => !r.cached && r.reason === "direct",
  );
  const cascadeMiss = results.filter(
    (r) => !r.cached && r.reason === "cascade",
  );

  if (directMiss.length > 0) {
    lines.push(
      `  ${c.red}Direct invalidation${c.reset} (inputs changed):`,
    );
    for (const r of directMiss) {
      const input = r.matchedInput === "*" ? "full source" : r.matchedInput;
      lines.push(
        `    ${c.red}MISS${c.reset}  ${r.name.padEnd(32)} ${c.dim}← ${input}${c.reset}`,
      );
    }
    lines.push("");
  }

  if (cascadeMiss.length > 0) {
    lines.push(
      `  ${c.yellow}Cascade invalidation${c.reset} (dependency changed):`,
    );
    for (const r of cascadeMiss) {
      const from =
        results.find((x) => x.id === r.cascadeFrom)?.name ?? r.cascadeFrom;
      lines.push(
        `    ${c.yellow}CASCADE${c.reset} ${r.name.padEnd(29)} ${c.dim}← ${from}${c.reset}`,
      );
    }
    lines.push("");
  }

  if (cached.length > 0) {
    lines.push(`  ${c.green}Cached${c.reset} (no re-execution needed):`);
    for (const r of cached) {
      lines.push(`    ${c.green}HIT${c.reset}   ${r.name}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderGantt(results: SimResult[]): string {
  const lines: string[] = [];
  const c = COLORS;
  const maxTime = Math.max(...results.map((r) => r.endTime), 1);

  // Chart width in characters
  const chartWidth = 60;
  const scale = chartWidth / maxTime;
  const nameWidth = 30;

  lines.push(`${c.bold}Execution Timeline:${c.reset}`);
  lines.push("");

  // Time axis header
  const timeMarks: string[] = [];
  const step = maxTime <= 60 ? 10 : maxTime <= 180 ? 30 : 60;
  for (let t = 0; t <= maxTime; t += step) {
    const pos = Math.round(t * scale);
    timeMarks.push(`${String(t).padStart(pos > 0 ? pos - (timeMarks.length > 0 ? timeMarks.join("").length : 0) : 0)}s`);
  }

  // Simpler time axis
  const axisLine = " ".repeat(nameWidth + 8);
  const marks: string[] = [];
  for (let t = 0; t <= maxTime; t += step) {
    marks.push(formatDuration(t));
  }
  lines.push(`${axisLine}${c.dim}${marks.join("    ")}${c.reset}`);

  // Sort by start time, then by duration (longest first)
  const sorted = [...results].sort(
    (a, b) => a.startTime - b.startTime || b.duration - a.duration,
  );

  for (const r of sorted) {
    const label = r.name.slice(0, nameWidth).padEnd(nameWidth);
    const startPos = Math.round(r.startTime * scale);
    const endPos = Math.max(Math.round(r.endTime * scale), startPos + (r.cached ? 0 : 1));
    const barLen = endPos - startPos;

    let status: string;
    let bar: string;
    if (r.cached) {
      status = `${c.green}HIT ${c.reset}`;
      bar = `${" ".repeat(startPos)}${c.green}${"·"}${c.reset}`;
    } else if (r.reason === "cascade") {
      status = `${c.yellow}CASC${c.reset}`;
      bar = `${" ".repeat(startPos)}${c.yellow}${"█".repeat(barLen)}${c.reset}`;
    } else {
      status = `${c.red}MISS${c.reset}`;
      bar = `${" ".repeat(startPos)}${c.red}${"█".repeat(barLen)}${c.reset}`;
    }

    const dur = r.cached ? "" : ` ${formatDuration(r.duration)}`;
    lines.push(`  ${label} ${status} ${bar}${c.dim}${dur}${c.reset}`);
  }

  lines.push("");
  return lines.join("\n");
}

function renderCriticalPath(criticalPath: SimResult[]): string {
  const lines: string[] = [];
  const c = COLORS;

  lines.push(`${c.bold}Critical Path:${c.reset}`);
  lines.push("");

  if (criticalPath.length === 0) {
    lines.push("  (all cached, no critical path)");
  } else {
    const parts = criticalPath
      .filter((r) => !r.cached)
      .map((r) => `${r.name} (${formatDuration(r.duration)})`);
    lines.push(`  ${c.cyan}${parts.join(`${c.dim} → ${c.cyan}`)}${c.reset}`);
  }

  lines.push("");
  return lines.join("\n");
}

function renderSummary(results: SimResult[]): string {
  const lines: string[] = [];
  const c = COLORS;

  const totalWallClock = Math.max(...results.map((r) => r.endTime));
  const totalWork = results.reduce((sum, r) => sum + r.duration, 0);
  const cachedCount = results.filter((r) => r.cached).length;
  const missCount = results.filter(
    (r) => !r.cached && r.reason === "direct",
  ).length;
  const cascadeCount = results.filter(
    (r) => !r.cached && r.reason === "cascade",
  ).length;
  const cascadeTime = results
    .filter((r) => !r.cached && r.reason === "cascade")
    .reduce((sum, r) => sum + r.duration, 0);

  // Full rebuild time (no caching)
  const fullBuildNodes = results.map((r) => ({
    ...r,
    cached: false,
    duration:
      PIPELINE.find((n) => n.id === r.id)?.duration ?? r.duration,
  }));
  const fullResults = simulate(
    PIPELINE.filter(
      (n) => results.some((r) => r.id === n.id),
    ),
    new Map(
      results.map((r) => [
        r.id,
        { cached: false, reason: "direct" as const },
      ]),
    ),
    results.some((r) =>
      PIPELINE.find((n) => n.id === r.id)?.releaseOnly,
    ),
  );
  const fullBuildTime = Math.max(...fullResults.map((r) => r.endTime));

  lines.push(`${c.bold}Summary:${c.reset}`);
  lines.push("");
  lines.push(
    `  Wall-clock time:     ${c.bold}${formatDuration(totalWallClock)}${c.reset}`,
  );
  lines.push(
    `  Full rebuild time:   ${formatDuration(fullBuildTime)}`,
  );
  lines.push(
    `  Cache savings:       ${formatDuration(fullBuildTime - totalWallClock)}`,
  );
  lines.push(
    `  Total work (serial): ${formatDuration(totalWork)}`,
  );
  lines.push("");
  lines.push(
    `  Nodes: ${c.green}${cachedCount} cached${c.reset}, ${c.red}${missCount} direct miss${c.reset}, ${c.yellow}${cascadeCount} cascade miss${c.reset}`,
  );

  if (cascadeCount > 0) {
    lines.push("");
    lines.push(
      `  ${c.yellow}Cascade waste:${c.reset} ${formatDuration(cascadeTime)} spent re-executing nodes`,
    );
    lines.push(
      `  whose own inputs didn't change (invalidated by dependency cascade).`,
    );
    lines.push(
      `  ${c.dim}Narrowing input granularity could eliminate this.${c.reset}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const c = COLORS;

  // Parse flags
  const isRelease = args.includes("--release");
  const isAll = args.includes("--all");
  const listPresets = args.includes("--list-presets");
  const presetIndex = args.indexOf("--preset");

  if (listPresets) {
    console.log(`\n${c.bold}Available presets:${c.reset}\n`);
    for (const [name, preset] of Object.entries(PRESETS)) {
      console.log(`  ${c.cyan}${name.padEnd(20)}${c.reset} ${preset.description}`);
      for (const f of preset.files) {
        console.log(`  ${" ".repeat(20)} ${c.dim}${f}${c.reset}`);
      }
    }
    console.log(
      `\n  Usage: bun scripts/simulate-ci.ts --preset <name> [--release]\n`,
    );
    return;
  }

  let changedFiles: string[];
  let scenarioName: string;

  if (isAll) {
    // Invalidate everything by providing a wildcard file
    changedFiles = ["__all__"];
    scenarioName = "Full rebuild (no caching)";
  } else if (presetIndex !== -1 && args[presetIndex + 1] !== undefined) {
    const presetName = args[presetIndex + 1];
    const preset = PRESETS[presetName];
    if (preset === undefined) {
      console.error(
        `Unknown preset: ${presetName}. Use --list-presets to see available presets.`,
      );
      process.exit(1);
    }
    changedFiles = preset.files;
    scenarioName = preset.description;
  } else {
    // Collect file arguments (skip flags)
    const fileArgs = args.filter(
      (a) => !a.startsWith("--"),
    );
    if (fileArgs.length > 0) {
      changedFiles = fileArgs;
      scenarioName = `Custom: ${fileArgs.join(", ")}`;
    } else {
      // Default: versions.ts change
      changedFiles = ["packages/homelab/src/cdk8s/src/versions.ts"];
      scenarioName = "Default: homelab versions.ts change";
    }
  }

  // Header
  console.log("");
  console.log(
    `${c.bold}${c.cyan}Dagger CI Pipeline Simulator${c.reset}`,
  );
  console.log(`${c.dim}${"─".repeat(60)}${c.reset}`);
  console.log(`  Scenario: ${c.bold}${scenarioName}${c.reset}`);
  console.log(`  Release:  ${isRelease ? `${c.yellow}yes${c.reset}` : "no"}`);
  console.log(`  Changed files:`);
  for (const f of changedFiles) {
    console.log(`    ${c.dim}${f}${c.reset}`);
  }
  console.log(`${c.dim}${"─".repeat(60)}${c.reset}`);
  console.log("");

  // Run simulation
  const cacheStatus = analyzeCache(PIPELINE, changedFiles, isRelease);
  const results = simulate(PIPELINE, cacheStatus, isRelease);
  const criticalPath = findCriticalPath(results);

  // Output
  console.log(renderCacheAnalysis(results, cacheStatus));
  console.log(renderGantt(results));
  console.log(renderCriticalPath(criticalPath));
  console.log(renderSummary(results));
}

main();
