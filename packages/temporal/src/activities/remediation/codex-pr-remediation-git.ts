import { rm } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod/v4";
import { envForTrustedAgent } from "#activities/agent/agent-task-env.ts";
import { rootInstallWithoutHooks } from "#activities/bot-clone.ts";
import {
  discardFormattingOnlyChanges,
  generatedTextPaths,
} from "#activities/scout/scout-generated-preflight.ts";
import {
  runCommand as defaultRunCommand,
  type GitCommandRunner,
} from "#activities/scout/scout-season-refresh-git.ts";
import { parsePorcelainPaths } from "#shared/porcelain.ts";

const AutoMergeStateSchema = z.enum(["true", "false"]);

const FORBIDDEN_REMEDIATION_ENV_PREFIXES = [
  "AWS_",
  "S3_",
  "REPORT_",
  "ALERTMANAGER_",
  "TEMPORAL_",
  "POSTAL_",
  "GITHUB_",
] as const;

export function remediationAgentEnv(
  openAiApiKey: string,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const sanitizedSource: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (
      key === "GH_TOKEN" ||
      FORBIDDEN_REMEDIATION_ENV_PREFIXES.some((prefix) =>
        key.startsWith(prefix),
      )
    ) {
      continue;
    }
    sanitizedSource[key] = value;
  }
  return envForTrustedAgent({ OPENAI_API_KEY: openAiApiKey }, sanitizedSource);
}

export function isSafeRelativeRepoPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\0")) {
    return false;
  }
  const segments = new Set(path.split("/"));
  return !segments.has("..") && !segments.has(".git");
}

export async function listDirtyRepoPaths(
  repoDir: string,
  commandRunner: GitCommandRunner = defaultRunCommand,
): Promise<string[]> {
  const status = await commandRunner(
    ["git", "status", "--porcelain", "-uall"],
    {
      cwd: repoDir,
      trimStdout: false,
    },
  );
  return [...new Set(parsePorcelainPaths(status))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export async function revertSingleRepoPath(
  repoDir: string,
  path: string,
  commandRunner: GitCommandRunner = defaultRunCommand,
): Promise<void> {
  if (!isSafeRelativeRepoPath(path)) {
    return;
  }
  const tracked = await commandRunner(["git", "ls-files", "--", path], {
    cwd: repoDir,
  });
  if (tracked.length > 0) {
    await commandRunner(["git", "checkout", "--", path], { cwd: repoDir });
    return;
  }
  await rm(nodePath.join(repoDir, path), { recursive: true, force: true });
}

export async function enforceAllowedPaths(input: {
  repoDir: string;
  isAllowedPath: (path: string) => boolean;
  commandRunner?: GitCommandRunner;
}): Promise<{ allowedFiles: string[]; revertedFiles: string[] }> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  await commandRunner(["git", "reset"], { cwd: input.repoDir });
  const dirtyPaths = await listDirtyRepoPaths(input.repoDir, commandRunner);
  const revertedFiles: string[] = [];

  for (const path of dirtyPaths) {
    if (!isSafeRelativeRepoPath(path) || !input.isAllowedPath(path)) {
      await revertSingleRepoPath(input.repoDir, path, commandRunner);
      revertedFiles.push(path);
    }
  }

  const allowedFiles = await listDirtyRepoPaths(input.repoDir, commandRunner);
  return { allowedFiles, revertedFiles };
}

export async function revertUnverifiedFiles(input: {
  repoDir: string;
  candidateFiles: readonly string[];
  verifiedFiles: readonly string[];
  commandRunner?: GitCommandRunner;
}): Promise<string[]> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  const verifiedSet = new Set(input.verifiedFiles);
  const reverted: string[] = [];

  for (const file of input.candidateFiles) {
    if (!verifiedSet.has(file)) {
      await revertSingleRepoPath(input.repoDir, file, commandRunner);
      reverted.push(file);
    }
  }
  return reverted;
}

export async function formatAndFilterAllowedFiles(input: {
  repoDir: string;
  changedFiles: readonly string[];
  formatFiles: boolean;
  commandRunner?: GitCommandRunner;
  installRootForPrettier?: (repoDir: string) => Promise<void>;
}): Promise<string[]> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  if (!input.formatFiles || input.changedFiles.length === 0) {
    return [...input.changedFiles];
  }
  const textPaths = generatedTextPaths(input.changedFiles);
  if (textPaths.length === 0) {
    return [...input.changedFiles];
  }
  const prettierBin = `${input.repoDir}/node_modules/.bin/prettier`;
  if (!(await Bun.file(prettierBin).exists())) {
    const installer = input.installRootForPrettier ?? rootInstallWithoutHooks;
    await installer(input.repoDir);
  }
  const existingTextPaths: string[] = [];
  for (const path of textPaths) {
    if (await Bun.file(`${input.repoDir}/${path}`).exists()) {
      existingTextPaths.push(path);
    }
  }
  if (existingTextPaths.length > 0) {
    await commandRunner(
      [
        "bunx",
        "--no-install",
        "prettier",
        "--write",
        "--ignore-unknown",
        "--",
        ...existingTextPaths,
      ],
      { cwd: input.repoDir },
    );
  }
  await discardFormattingOnlyChanges({
    repoDir: input.repoDir,
    changedFiles: input.changedFiles,
    component: "codex-pr-remediation",
  });
  return listDirtyRepoPaths(input.repoDir, commandRunner);
}

export function remediationBranchName(
  slug: string,
  unifiedDiff: string,
): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(unifiedDiff)
    .digest("hex");
  return `chore/${slug}-${digest.slice(0, 8)}`;
}

export async function unifiedDiffForFiles(
  repoDir: string,
  files: readonly string[],
  commandRunner: GitCommandRunner = defaultRunCommand,
): Promise<string> {
  for (const file of files) {
    const tracked = await commandRunner(["git", "ls-files", "--", file], {
      cwd: repoDir,
    });
    if (tracked.length === 0) {
      await commandRunner(["git", "add", "-N", "--", file], { cwd: repoDir });
    }
  }
  return commandRunner(
    ["git", "-c", "core.pager=cat", "diff", "--no-color", "--", ...files],
    { cwd: repoDir },
  );
}

export function buildRemediationPrBody(input: {
  why: string;
  what: string;
  changedFiles: readonly string[];
  resolvedCount: number;
  unresolvedCount: number;
  verificationSummary: string;
  demo: string;
  autoMerge: boolean;
}): string {
  return [
    "## Why",
    "",
    input.why,
    "",
    "## What",
    "",
    input.what,
    "",
    `- Resolved items: ${String(input.resolvedCount)}`,
    `- Unresolved items: ${String(input.unresolvedCount)}`,
    `- Changed files (${String(input.changedFiles.length)}): ${input.changedFiles.map((file) => `\`${file}\``).join(", ")}`,
    "",
    "## Verification",
    "",
    input.verificationSummary,
    "",
    input.autoMerge
      ? "Auto-merge requested after Woodpecker CI and automated review pass. Live post-merge runtime acceptance has not run."
      : "Auto-merge is disabled; human review and merge required. Live post-merge runtime acceptance has not run.",
    "",
    "## Demo",
    "",
    input.demo,
  ].join("\n");
}

export async function configureRemediationPrAutoMerge(input: {
  repoDir: string;
  repoSlug: string;
  prUrl: string;
  ghToken: string;
  autoMerge: boolean;
  commandRunner?: GitCommandRunner;
}): Promise<boolean> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  if (input.autoMerge) {
    try {
      await commandRunner(
        [
          "gh",
          "pr",
          "merge",
          "--repo",
          input.repoSlug,
          "--auto",
          "--squash",
          input.prUrl,
        ],
        {
          cwd: input.repoDir,
          env: { GH_TOKEN: input.ghToken },
          redactOutput: true,
          operation: "pr-enable-auto-merge",
        },
      );
      return true;
    } catch (error: unknown) {
      console.warn(
        JSON.stringify({
          level: "warning",
          component: "codex-pr-remediation",
          msg: "Failed to configure auto-merge on remediation PR; preserving PR for manual review",
          prUrl: input.prUrl,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  try {
    const autoMergeState = AutoMergeStateSchema.parse(
      await commandRunner(
        [
          "gh",
          "pr",
          "view",
          input.prUrl,
          "--repo",
          input.repoSlug,
          "--json",
          "autoMergeRequest",
          "--jq",
          ".autoMergeRequest != null",
        ],
        {
          cwd: input.repoDir,
          env: { GH_TOKEN: input.ghToken },
          redactOutput: true,
          operation: "pr-read-auto-merge",
        },
      ),
    );
    if (autoMergeState === "true") {
      await commandRunner(
        [
          "gh",
          "pr",
          "merge",
          input.prUrl,
          "--repo",
          input.repoSlug,
          "--disable-auto",
        ],
        {
          cwd: input.repoDir,
          env: { GH_TOKEN: input.ghToken },
          redactOutput: true,
          operation: "pr-disable-auto-merge",
        },
      );
    }
  } catch (error: unknown) {
    console.warn(
      JSON.stringify({
        level: "warning",
        component: "codex-pr-remediation",
        msg: "Could not inspect or disable prior auto-merge state on plain review PR",
        prUrl: input.prUrl,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return false;
}
