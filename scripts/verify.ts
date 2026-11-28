import { readdir } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod";
import { rootCheckEnvironment } from "./ci/root-check-inputs.ts";
import { prettierChangedEnvironment } from "./ci/run-shard-check.ts";

const turboTasks = [
  "build",
  "typecheck",
  "test:ci",
  "coverage:portable:check",
  "lint",
  "check-suppressions",
  "check-agent-guidance",
  "check-directory-file-counts",
  "check-flag-usage",
  "check-ai-architecture",
  "check-floating-deps",
  "check-patched-deps",
  "check-ci-env",
  "check-ci-admission-budget",
  "check-script-migrations",
  "check-test-standardization",
  "script-coverage",
  "markdownlint",
  "prettier-scout",
  "prettier-homelab",
  "prettier-packages",
  "prettier-root",
  "shellcheck",
  "hadolint",
  "knip",
  "gitleaks",
  "jscpd",
  "quality-ratchet",
  "compliance-check",
  "lockfile-check",
  "merge-conflicts",
  "env-var-names",
  "line-endings-scout",
  "line-endings-homelab",
  "line-endings-packages",
  "line-endings-root",
  "react-version-sync",
  "toolchain-version-sync",
  "mise-lock-sync",
  "renovate-hints",
  "large-files-scout",
  "large-files-homelab",
  "large-files-packages",
  "large-files-root",
  "scout-asset-sizes",
  "guard:migration",
  "ruff",
  "pyright",
  "tunnel-dns-coverage",
  "check:talos",
  "lint:helm",
  "check:kubeconform",
  "check:1password",
  "check:ios-native-deps",
  "lint:swift",
  "check:caddyfile",
] as const;

/**
 * Turbo slots and the Vitest worker cap per suite; scripts/verify-extended.ts
 * runs the extended tier under the same budget.
 */
export const VERIFY_CONCURRENCY = 6;
export const VERIFY_VITEST_MAX_WORKERS = 2;

type GitValidator = (command: readonly string[]) => Promise<number>;
type ChangedFilesReader = (
  base: string,
) => Promise<readonly string[] | undefined>;

export const ROOT_SCRIPTS_EXTERNAL_INPUTS = [
  "packages/version-catalog/src/catalog.json",
  "packages/tasks-for-obsidian/ios/ci_scripts/",
  "packages/dotfiles/dot_local/bin/executable_cf",
  "packages/discord-plays-pokemon/Dockerfile",
  "packages/streambot/Dockerfile",
  "packages/homelab/src/talos/liskov/patches/image.yaml",
  "packages/homelab/src/talos/torvalds/patches/image.yaml",
  "packages/discord-plays-pokemon/wasm-src/upstream.json",
  "packages/discord-plays-mario-kart/Dockerfile",
  "packages/homelab/images/redlib/Dockerfile",
  "ci/ci-playwright/Dockerfile",
  "packages/windows-cross-compiler/",
  "packages/macos-cross-compiler/",
  ".mise.toml",
  "global.json",
  "docker-bake.hcl",
  "ci/application-image-smoke.Dockerfile",
  "packages/scout-for-lol/packages/backend/Dockerfile",
  "packages/homelab/src/cdk8s/src/resources/woodpecker/bun-cache-gc.sh",
  "packages/homelab/mac-ci/bootstrap.sh",
  "packages/homelab/mac-ci/provision-host.sh",
  "packages/feature-flags/src/managed-flag-inventory.ts",
  "packages/feature-flags/src/flags-drift.ts",
  "packages/feature-flags/src/flags-reconcile.ts",
  "packages/feature-flags/src/managed-flag-inventory.json",
  // renovate-config.test.ts extracts every hinted version pin from its file.
  "packages/temporal/Dockerfile",
  "packages/media/Dockerfile",
  "packages/delivery/Dockerfile",
  "packages/fonts/patch-berkeley-mono.py",
  "packages/toolkit/src/lib/brim/capture/engine.ts",
  "packages/the-storm/plugin/gradle/libs.versions.toml",
  // renovate-mirrored-pins.test.ts extracts the Minecraft plugin, itzg mirror and
  // ffsubsync pins from these files.
  "packages/the-storm/server/plugins.json",
  "packages/the-storm/tests/e2e/harness/pins.ts",
  "packages/mc-harness/src/pins.ts",
  "packages/the-storm/plugin/dist/build.gradle.kts",
  "packages/the-storm/plugin/settings.gradle.kts",
  "packages/woodpecker-config-extension/src/images.ts",
  "packages/woodpecker-config-extension/src/pipeline/lanes/storm-e2e.ts",
  "packages/media/scripts/subtitle-requirements.txt",
] as const;

async function validateBaseWithGit(
  command: readonly string[],
): Promise<number> {
  const child = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
  });
  return child.exited;
}

async function readChangedFilesWithGit(
  base: string,
): Promise<readonly string[] | undefined> {
  const child = Bun.spawn(
    ["git", "diff", "--no-renames", "--name-only", base, "HEAD"],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const [exitCode, output] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  return exitCode === 0
    ? output.split("\n").filter((path) => path !== "")
    : undefined;
}

function rootScriptsInputsChanged(changedFiles: readonly string[]): boolean {
  return changedFiles.some(
    (path) =>
      path === "ci" ||
      path.startsWith("ci/") ||
      path === "renovate.json" ||
      path === "package.json" ||
      path.endsWith("/package.json") ||
      (path.startsWith("packages/") && path.endsWith("/turbo.json")) ||
      ROOT_SCRIPTS_EXTERNAL_INPUTS.some((input) =>
        input.endsWith("/") ? path.startsWith(input) : path === input,
      ),
  );
}

export async function affectedVerifyFilters(
  environment: Readonly<Record<string, string | undefined>>,
  validate: GitValidator = validateBaseWithGit,
  readChangedFiles: ChangedFilesReader = readChangedFilesWithGit,
): Promise<string[]> {
  if (environment["CI_IO_FIXED_CORPUS"] === "true") return [];
  const base = environment["CI_CHANGED_BASE"]?.trim();
  if (base === undefined || base === "") return [];
  const checks = [
    ["git", "cat-file", "-e", `${base}^{commit}`],
    ["git", "merge-base", "--is-ancestor", base, "HEAD"],
  ] as const;
  for (const command of checks) {
    if ((await validate(command)) !== 0) {
      console.error(
        `WARN: CI changed-file base ${base} is invalid; running full verification`,
      );
      return [];
    }
  }
  const changedFiles = await readChangedFiles(base);
  if (changedFiles === undefined) {
    console.error(
      `WARN: could not read changed files from CI base ${base}; running full verification`,
    );
    return [];
  }
  // The affected package graph and the root namespace are a union. Root checks
  // remain represented, but Turbo executes only the ones whose declared input
  // hashes changed. Package tasks cover changed workspaces plus reverse
  // dependents and their task dependencies.
  const filters = [`--filter=...[${base}]`, "--filter=//"];
  // The shared theme's title consistency test reads player pages. The docs
  // already depend on the theme, so declaring the reverse workspace edge
  // would create a cycle; select this cross-package test explicitly.
  if (
    changedFiles.some((file) =>
      file.startsWith("packages/ts-mc-docs/src/content/docs/"),
    )
  ) {
    filters.push("--filter=@shepherdjerred/storm-theme");
  }
  if (rootScriptsInputsChanged(changedFiles)) {
    filters.push("--filter=@shepherdjerred/root-scripts");
  }
  return filters;
}

const TurboSummarySchema = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      execution: z
        .object({
          startTime: z.number(),
          endTime: z.number().optional(),
          exitCode: z.number().int().nullable().optional(),
        })
        .optional(),
    }),
  ),
});

export async function listTurboSummaryFiles(
  rootDirectory: string,
): Promise<Set<string>> {
  try {
    const entries = await readdir(
      nodePath.join(rootDirectory, ".turbo", "runs"),
    );
    return new Set(entries.filter((name) => name.endsWith(".json")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

export async function readNewTurboSummaries(
  rootDirectory: string,
  previousFiles: ReadonlySet<string>,
): Promise<unknown[]> {
  let currentFiles: Set<string>;
  try {
    currentFiles = await listTurboSummaryFiles(rootDirectory);
  } catch {
    return [];
  }
  const newNames = [...currentFiles]
    .filter((name) => !previousFiles.has(name))
    .sort((left, right) => left.localeCompare(right));
  const summaries: unknown[] = [];
  for (const name of newNames) {
    try {
      summaries.push(
        await Bun.file(
          nodePath.join(rootDirectory, ".turbo", "runs", name),
        ).json(),
      );
    } catch {
      // Best-effort diagnostic: skip unreadable or partially flushed summary files.
    }
  }
  return summaries;
}

export function formatTurboFailureSummary(
  summaries: readonly unknown[],
  nowMs = Date.now(),
): string[] {
  const inFlight: string[] = [];
  const failed: string[] = [];
  let unstartedCount = 0;

  for (const rawSummary of summaries) {
    const parsed = TurboSummarySchema.safeParse(rawSummary);
    if (!parsed.success) continue;
    for (const task of parsed.data.tasks) {
      const execution = task.execution;
      if (execution === undefined) {
        unstartedCount += 1;
        continue;
      }
      if (
        execution.endTime === undefined ||
        execution.exitCode === null ||
        execution.exitCode === undefined
      ) {
        const elapsedSeconds = Math.max(
          0,
          Math.round((nowMs - execution.startTime) / 1000),
        );
        inFlight.push(`${task.taskId} (running ${String(elapsedSeconds)}s)`);
      } else if (execution.exitCode !== 0) {
        failed.push(`${task.taskId} (exit ${String(execution.exitCode)})`);
      }
    }
  }

  const lines: string[] = [];
  if (inFlight.length > 0) {
    lines.push(
      `[verify] Turbo in-flight task(s) (${String(inFlight.length)}): ${inFlight.join(", ")}`,
    );
  }
  if (failed.length > 0) {
    lines.push(
      `[verify] Turbo failed task(s) (${String(failed.length)}): ${failed.join(", ")}`,
    );
  }
  if (unstartedCount > 0) {
    lines.push(`[verify] Turbo unstarted task(s): ${String(unstartedCount)}`);
  }
  return lines;
}

export async function main(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<number> {
  const forwardedArgs = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  // `toolkit ci analyze` reads the task list instead of copying it.
  if (forwardedArgs.length === 1 && forwardedArgs[0] === "--list-tasks") {
    console.log(JSON.stringify(turboTasks));
    return 0;
  }
  const hasConcurrencyOverride = forwardedArgs.some(
    (argument) =>
      argument === "--concurrency" || argument.startsWith("--concurrency="),
  );
  const affectedFilters = await affectedVerifyFilters(environment);
  const rootDirectory = process.cwd();
  const previousSummaries = await listTurboSummaryFiles(rootDirectory).catch(
    () => new Set<string>(),
  );
  const turbo = Bun.spawn(
    [
      "bun",
      "x",
      "--no-install",
      "turbo",
      "run",
      ...turboTasks,
      "--continue",
      // The CI verify pod has a 12-CPU limit. Most tasks are short lint,
      // typecheck and root checks that queued behind long test suites at
      // three slots, so Turbo runs six. Vitest workers are what oversubscribe
      // the pod, so each suite is capped at VERIFY_VITEST_MAX_WORKERS instead:
      // six suites at two workers stay within the limit.
      ...(hasConcurrencyOverride
        ? []
        : [`--concurrency=${String(VERIFY_CONCURRENCY)}`]),
      ...affectedFilters,
      ...forwardedArgs,
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...(await rootCheckEnvironment(environment)),
        ...(await prettierChangedEnvironment(environment)),
        CI_VITEST_MAX_WORKERS:
          environment["CI_VITEST_MAX_WORKERS"] ??
          String(VERIFY_VITEST_MAX_WORKERS),
      },
    },
  );
  const forwardInterrupt = (): void => {
    turbo.kill("SIGINT");
  };
  const forwardTerminate = (): void => {
    turbo.kill("SIGTERM");
  };
  process.on("SIGINT", forwardInterrupt);
  process.on("SIGTERM", forwardTerminate);
  let turboExitCode: number;
  try {
    turboExitCode = await turbo.exited;
  } finally {
    process.off("SIGINT", forwardInterrupt);
    process.off("SIGTERM", forwardTerminate);
  }
  if (turboExitCode !== 0) {
    const summaries = await readNewTurboSummaries(
      rootDirectory,
      previousSummaries,
    );
    for (const line of formatTurboFailureSummary(summaries)) {
      console.error(line);
    }
    return turboExitCode;
  }

  const designTokenCheck = Bun.spawn(
    [
      "bun",
      "--no-install",
      "run",
      "--cwd",
      "packages/scout-for-lol/packages/design-audit",
      "check:tokens",
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: environment,
    },
  );
  const designTokenExitCode = await designTokenCheck.exited;
  if (designTokenExitCode !== 0) return designTokenExitCode;

  const dockerfileCopies = Bun.spawn(
    ["bun", "--no-install", "scripts/checks/dockerfile-workspace-copies.ts"],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: environment,
    },
  );
  const dockerfileCopiesExitCode = await dockerfileCopies.exited;
  if (dockerfileCopiesExitCode !== 0) return dockerfileCopiesExitCode;

  const analyticsCheck = Bun.spawn(
    ["bun", "--no-install", "scripts/checks/check-analytics-sites.ts"],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: environment,
    },
  );
  return analyticsCheck.exited;
}

if (import.meta.main) process.exitCode = await main();
