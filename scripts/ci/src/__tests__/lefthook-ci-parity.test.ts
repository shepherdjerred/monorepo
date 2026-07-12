import { describe, expect, it } from "bun:test";
import { buildPipeline } from "../pipeline-builder.ts";
import type { AffectedPackages } from "../lib/types.ts";
import {
  ALL_PACKAGES,
  PACKAGES_WITH_IMAGES,
  PACKAGES_WITH_NPM,
  PACKAGE_TO_SITE,
} from "../catalog.ts";

/**
 * Pre-commit ↔ CI parity guard.
 *
 * lefthook is advisory — `--no-verify` (or any tool that skips hooks) bypasses
 * it, so CI must be the real gate. This test asserts every lefthook leaf job is
 * accounted for: it either maps to a generated CI step, belongs to a
 * per-package family that the per-package generator covers, or is an explicit,
 * documented exception. A new pre-commit check added without a CI decision
 * fails here — which is exactly how `check-todos` slipped through (it ran only
 * in pre-commit until this parity gate was added).
 */

const LEFTHOOK_PATH = `${import.meta.dir}/../../../../lefthook.yml`;
const LEFTHOOK_YAML = await Bun.file(LEFTHOOK_PATH).text();

/**
 * Repo-wide checks → the `key` of their generated CI step. Each value is
 * asserted to exist in a full pipeline, so renaming/removing a CI step without
 * updating this map fails the test.
 *
 * Many lefthook checks now collapse into one bundled CI step `quality-bundle`
 * (one BK pod runs all 15 children in parallel via Dagger Promise.all). The
 * source of truth for the bundle's children is
 * `.dagger/src/quality.ts:qualityBundleHelper` — removing a child there
 * silently drops it from CI, so this parity test treats the bundle as the
 * single mapped step. The bundle either runs every child or fails atomically.
 */
const JOB_TO_CI_STEP: Record<string, string> = {
  gitleaks: "quality-bundle",
  "env-var-names": "quality-bundle",
  "merge-conflicts": "quality-bundle",
  "large-files": "soft-fail-bundle",
  "line-endings": "quality-bundle",
  "check-suppressions": "quality-bundle",
  "check-todos": "quality-bundle",
  "migration-guard": "quality-bundle",
  "lockfile-check": "quality-bundle",
  shellcheck: "quality-bundle",
  ruff: "quality-bundle",
  pyright: "quality-bundle",
  // Non-package automation dirs, bundled as the `eslint-automation` child.
  "eslint-root-scripts": "quality-bundle",
  "eslint-ci-scripts": "quality-bundle",
  "eslint-dagger": "quality-bundle",
  "compliance-check": "quality-bundle",
  "quality-ratchet": "quality-bundle",
  "scout-test-template-check": "quality-bundle",
  "react-version-sync": "quality-bundle",
  // cdk8s synth + 1Password lint collapse into one bundled step `homelab-cdk8s`.
  "onepassword-items": "homelab-cdk8s",
  // Desktop Tauri crate: fmt+clippy locally; CI step adds `cargo test`.
  "scout-desktop-rust": "scout-desktop-rust",
};

/**
 * Per-package families — covered by the per-package step generator
 * (lint/typecheck/test/build per package, gated by change detection). Verified
 * structurally by `pipeline-builder.test.ts`, so we don't assert a specific key
 * here, only that the job belongs to a recognized family.
 */
const PER_PACKAGE_PATTERNS: RegExp[] = [
  /^eslint-/,
  /-typecheck$/,
  /-test$/,
  /^go-(build|test|lint)$/,
];
const PER_PACKAGE_JOBS = new Set<string>([
  "birmel-check",
  "homelab-versions-validate",
  "homelab-helm-lint",
  "sjer-red-astro-check",
  "full-typecheck",
]);

/**
 * Checks that run repo-wide in CI but as async/soft-fail or otherwise outside
 * the blocking-gate list — still present in a full pipeline, mapped here so
 * they're acknowledged rather than flagged as drift.
 */
const ASYNC_OR_SOFT_CI: Record<string, string> = {
  // prettier + markdownlint moved into `quality-bundle` (still blocking).
  prettier: "quality-bundle",
  markdownlint: "quality-bundle",
  "dagger-hygiene": "soft-fail-bundle",
  "tunnel-dns-coverage": "tunnel-dns-coverage",
  "talos-schematic-sync": "talos-schematic-sync",
};

/** Jobs intentionally pre-commit-only (NOT a CI gate). Document the reason. */
const PRECOMMIT_ONLY: Record<string, string> = {
  // Runs on the `commit-msg` hook, not pre-commit; commit messages are a local
  // authoring concern (PRs squash-merge with a curated title).
  "validate-commit-msg": "commit-msg hook; not a mergeable artifact",
};

/** Extract leaf job names (jobs that actually run a check, i.e. have a `run:`). */
function leafJobNames(yaml: string): string[] {
  const lines = yaml.split("\n");
  const nameRe = /^\s*-\s*name:\s*(\S+)/;
  const runRe = /^\s*run:(?:\s|$)/;
  const jobStarts: { name: string; line: number }[] = [];
  lines.forEach((line, i) => {
    const m = nameRe.exec(line);
    if (m?.[1] !== undefined) jobStarts.push({ name: m[1], line: i });
  });
  const leaves: string[] = [];
  jobStarts.forEach((job, idx) => {
    const next = jobStarts[idx + 1];
    const end = next === undefined ? lines.length : next.line;
    const block = lines.slice(job.line, end);
    if (block.some((l) => runRe.test(l))) leaves.push(job.name);
  });
  return leaves;
}

function fullBuild(): AffectedPackages {
  return {
    packages: new Set(ALL_PACKAGES),
    directlyChanged: new Set(),
    buildAll: true,
    homelabChanged: true,
    tofuChanged: true,
    cooklangChanged: true,
    resumeChanged: true,
    helmTypesInputsChanged: true,
    ciImageChanged: false,
    hasImagePackages: new Set(PACKAGES_WITH_IMAGES),
    hasSitePackages: new Set(Object.keys(PACKAGE_TO_SITE)),
    hasNpmPackages: new Set(PACKAGES_WITH_NPM),
    ciImageVersionChanged: false,
    versionBumpOnly: false,
    releasePleaseMerge: false,
    isAutoGenerated: false,
  };
}

function collectStepKeys(steps: unknown[], out: Set<string>): void {
  for (const step of steps) {
    if (step === null || typeof step !== "object") continue;
    // Groups nest their members under `steps`; recurse into them.
    const nested = Reflect.get(step, "steps");
    if (Array.isArray(nested)) collectStepKeys(nested, out);
    // Plain steps carry a `key`.
    const key = Reflect.get(step, "key");
    if (typeof key === "string") out.add(key);
  }
}

describe("lefthook ↔ CI parity", () => {
  const yaml = LEFTHOOK_YAML;
  const leaves = leafJobNames(yaml);

  it("finds the lefthook leaf jobs (sanity)", () => {
    expect(leaves.length).toBeGreaterThan(20);
    expect(leaves).toContain("check-todos");
    expect(leaves).toContain("migration-guard");
    // group containers must NOT be treated as leaf checks
    expect(leaves).not.toContain("safety-checks");
    expect(leaves).not.toContain("staged-lint");
    expect(leaves).not.toContain("tier-1");
  });

  it("every lefthook leaf job is accounted for (mapped to CI or explicitly exempt)", () => {
    const uncategorized = leaves.filter((name) => {
      if (name in JOB_TO_CI_STEP) return false;
      if (name in ASYNC_OR_SOFT_CI) return false;
      if (name in PRECOMMIT_ONLY) return false;
      if (PER_PACKAGE_JOBS.has(name)) return false;
      if (PER_PACKAGE_PATTERNS.some((re) => re.test(name))) return false;
      return true;
    });
    expect(
      uncategorized,
      `Uncategorized lefthook jobs — add a CI step (and map it in JOB_TO_CI_STEP / ASYNC_OR_SOFT_CI), ` +
        `tag it as a per-package family, or add to PRECOMMIT_ONLY with a reason: ${uncategorized.join(", ")}`,
    ).toEqual([]);
  });

  it("repo-wide checks mapped to a CI step actually appear in a full pipeline", () => {
    const pipeline = buildPipeline(fullBuild());
    const keys = new Set<string>();
    collectStepKeys(pipeline.steps, keys);

    const expectedKeys = [
      ...Object.values(JOB_TO_CI_STEP),
      ...Object.values(ASYNC_OR_SOFT_CI),
    ];
    const missing = expectedKeys.filter((key) => !keys.has(key));
    expect(
      missing,
      `These CI step keys are mapped from a lefthook job but absent from a full pipeline: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("check-todos specifically is now a CI gate (regression guard)", () => {
    expect(leaves).toContain("check-todos");
    // check-todos runs inside the bundled `quality-bundle` step.
    expect(JOB_TO_CI_STEP["check-todos"]).toBe("quality-bundle");
    const pipeline = buildPipeline(fullBuild());
    const keys = new Set<string>();
    collectStepKeys(pipeline.steps, keys);
    expect(keys.has("quality-bundle")).toBe(true);
  });
});
