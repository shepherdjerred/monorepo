#!/usr/bin/env bun

import path from "node:path";
import { z } from "zod";
import { TestManifestSchema, type TestStep } from "./ci-reporting.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const sourceExtensions = /\.[cm]?[jt]sx?$/u;
const forbiddenTestImport = /bun:test|node:test/u;
const nativeBunTestInvocation = /\[\s*["']bun["']\s*,\s*["']test["']\s*[,\]]/u;
const nativeBunTest = /(?:^|[;&|]\s*)bun(?:\s+--[^\s;&|]+)*\s+test(?:\s|$)/;
const nonVitestRunner = /(?:^|\s)(?:jest|mocha|ava|jasmine)(?:\s|$)/;
const canonicalPlaywright = "bun --no-install --bun playwright test";

type PackageManifest = {
  name?: string | undefined;
  scripts?: Record<string, string> | undefined;
};

const RootPackageSchema = z.object({ workspaces: z.array(z.string()) });
const PackageManifestSchema = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

export function sourceViolation(
  file: string,
  contents: string,
): string | undefined {
  if (forbiddenTestImport.test(contents)) {
    return `${file}: JavaScript and TypeScript tests must import from vitest, not bun:test or node:test`;
  }
  if (nativeBunTestInvocation.test(contents)) {
    return `${file}: invoke the workspace's Vitest script instead of spawning bun test`;
  }
  return undefined;
}

export function packageScriptViolations(
  file: string,
  manifest: PackageManifest,
): string[] {
  const violations: string[] = [];
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (nativeBunTest.test(command)) {
      violations.push(
        `${file}#${name}: use the workspace's Vitest command through bun --no-install --bun`,
      );
    }
    if (nonVitestRunner.test(command)) {
      violations.push(
        `${file}#${name}: Vitest is the only active JavaScript/TypeScript test runner`,
      );
    }
    if (
      command.includes("playwright test") &&
      !command.includes(canonicalPlaywright)
    ) {
      violations.push(
        `${file}#${name}: Playwright must run as ${canonicalPlaywright}`,
      );
    }
  }
  return violations;
}

export function manifestStepViolations(
  packageName: string,
  steps: readonly TestStep[],
): string[] {
  const violations: string[] = [];
  for (const step of steps) {
    const isCoreTemporalWorkflowSuite =
      packageName === "@shepherdjerred/temporal" &&
      step.args?.length === 4 &&
      step.args[0] === "src/workflows" &&
      step.args[1] === "--exclude" &&
      step.args[2] === "src/workflows/agent-task.test.ts" &&
      step.args[3] === "--no-file-parallelism";
    const isScoutTemporalWorkflowSuite =
      packageName === "@scout-for-lol/temporal" &&
      step.args?.length === 2 &&
      step.args[0] === "src/workflows" &&
      step.args[1] === "--no-file-parallelism";
    if (
      step.runner === "vitest" &&
      step.runtime === "node" &&
      ((!isCoreTemporalWorkflowSuite && !isScoutTemporalWorkflowSuite) ||
        step.runtimeReason === undefined)
    ) {
      violations.push(
        `scripts/ci-test-manifest.json (${packageName}): Node-hosted Vitest is restricted to Temporal SDK workflow tests with an explicit reason`,
      );
    }
    if (
      step.runner === "command" &&
      (nativeBunTest.test(step.command.join(" ")) ||
        nonVitestRunner.test(step.command.join(" ")))
    ) {
      violations.push(
        `scripts/ci-test-manifest.json (${packageName}): JavaScript/TypeScript test steps must use the vitest runner`,
      );
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const rootManifest = RootPackageSchema.parse(
    await Bun.file(path.join(repositoryRoot, "package.json")).json(),
  );
  const activeRoots = new Set(rootManifest.workspaces);
  const trackedFilesOutput =
    await Bun.$`git ls-files -co --exclude-standard`.text();
  const trackedFiles = trackedFilesOutput.trim().split("\n").filter(Boolean);
  const violations: string[] = [];

  for (const file of trackedFiles) {
    if (!sourceExtensions.test(file)) continue;
    if (!(await Bun.file(file).exists())) continue;
    if (
      file === "scripts/check-test-standardization.ts" ||
      file === "scripts/check-test-standardization.test.ts"
    ) {
      continue;
    }
    if (file.startsWith("sandbox/")) continue;
    const active =
      file.startsWith("scripts/") ||
      file.startsWith(".buildkite/") ||
      [...activeRoots].some((root) => file.startsWith(`${root}/`));
    if (!active) continue;
    const violation = sourceViolation(file, await Bun.file(file).text());
    if (violation !== undefined) violations.push(violation);
  }

  for (const workspace of activeRoots) {
    const file = path.join(workspace, "package.json");
    const manifest = PackageManifestSchema.parse(await Bun.file(file).json());
    violations.push(...packageScriptViolations(file, manifest));
  }

  const manifest = TestManifestSchema.parse(
    await Bun.file(
      path.join(repositoryRoot, "scripts/ci-test-manifest.json"),
    ).json(),
  );
  for (const workspace of manifest.workspaces) {
    violations.push(
      ...manifestStepViolations(workspace.package, workspace.steps),
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `Test standardization violations:\n${violations.join("\n")}`,
    );
  }
  console.log("Vitest and Playwright Bun runtime standards passed.");
}

if (import.meta.main) await main();
