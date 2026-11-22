import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { z } from "zod/v4";
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

const ALLOWED_REMEDIATION_RUNTIME_ENV_KEYS = new Set([
  "BUN_INSTALL",
  "CARGO_HOME",
  "GOMODCACHE",
  "GOPATH",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "MISE_CONFIG_DIR",
  "MISE_DATA_DIR",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "RUSTUP_HOME",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "UV_CACHE_DIR",
  "XDG_CACHE_HOME",
]);

export function remediationAgentEnv(
  openAiApiKey: string,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const allowlisted: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (
      typeof value === "string" &&
      ALLOWED_REMEDIATION_RUNTIME_ENV_KEYS.has(key)
    ) {
      allowlisted[key] = value;
    }
  }
  allowlisted["OPENAI_API_KEY"] = openAiApiKey;
  return allowlisted;
}

export function isolatedRemediationCommandEnv(
  overrides: Readonly<Record<string, string>> = {},
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string | undefined> {
  const isolated: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    isolated[key] =
      typeof value === "string" && ALLOWED_REMEDIATION_RUNTIME_ENV_KEYS.has(key)
        ? value
        : undefined;
  }
  for (const [key, value] of Object.entries(overrides)) {
    isolated[key] = value;
  }
  return isolated;
}

export function isSafeRelativeRepoPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\0")) {
    return false;
  }
  const segments = new Set(path.split("/"));
  return !segments.has("..") && !segments.has(".git");
}

export async function createScratchWorkspace(slug: string): Promise<{
  tempDir: string;
  repoDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(
    nodePath.join(tmpdir(), `temporal-remediation-${slug}-`),
  );
  await chmod(tempDir, 0o711);
  return {
    tempDir,
    repoDir: `${tempDir}/monorepo`,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

export async function resolveRepoBaseSha(
  repoDir: string,
  commandRunner: GitCommandRunner = defaultRunCommand,
): Promise<string | undefined> {
  return (await Bun.file(`${repoDir}/.git/HEAD`).exists())
    ? commandRunner(["git", "rev-parse", "HEAD"], { cwd: repoDir })
    : undefined;
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
  baseRef?: string,
): Promise<void> {
  if (!isSafeRelativeRepoPath(path)) {
    return;
  }
  const tracked =
    baseRef === undefined
      ? await commandRunner(["git", "ls-files", "--", path], { cwd: repoDir })
      : await commandRunner(
          ["git", "ls-tree", "--name-only", baseRef, "--", path],
          {
            cwd: repoDir,
          },
        );
  if (tracked.length > 0) {
    const checkoutArgs =
      baseRef === undefined
        ? ["git", "checkout", "--", path]
        : ["git", "checkout", baseRef, "--", path];
    await commandRunner(checkoutArgs, { cwd: repoDir });
    return;
  }
  await rm(nodePath.join(repoDir, path), { recursive: true, force: true });
}

export async function enforceAllowedPaths(input: {
  repoDir: string;
  baseSha?: string;
  isAllowedPath: (path: string) => boolean;
  commandRunner?: GitCommandRunner;
}): Promise<{ allowedFiles: string[]; revertedFiles: string[] }> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  const resetArgs =
    input.baseSha === undefined
      ? ["git", "reset"]
      : ["git", "reset", "--mixed", input.baseSha];
  await commandRunner(resetArgs, { cwd: input.repoDir });

  const dirtyPaths = await listDirtyRepoPaths(input.repoDir, commandRunner);
  const revertedFiles: string[] = [];

  for (const path of dirtyPaths) {
    if (!isSafeRelativeRepoPath(path) || !input.isAllowedPath(path)) {
      await revertSingleRepoPath(
        input.repoDir,
        path,
        commandRunner,
        input.baseSha,
      );
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
  baseSha?: string;
  commandRunner?: GitCommandRunner;
}): Promise<string[]> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  const verifiedSet = new Set(input.verifiedFiles);
  const reverted: string[] = [];

  for (const file of input.candidateFiles) {
    if (!verifiedSet.has(file)) {
      await revertSingleRepoPath(
        input.repoDir,
        file,
        commandRunner,
        input.baseSha,
      );
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
      { cwd: input.repoDir, env: isolatedRemediationCommandEnv() },
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

async function readPrAutoMergeArmed(input: {
  repoDir: string;
  repoSlug: string;
  prUrl: string;
  ghToken: string;
  commandRunner: GitCommandRunner;
}): Promise<boolean> {
  const raw = await input.commandRunner(
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
  );
  return AutoMergeStateSchema.parse(raw) === "true";
}

async function ensurePrAutoMergeDisabled(input: {
  repoDir: string;
  repoSlug: string;
  prUrl: string;
  ghToken: string;
  commandRunner: GitCommandRunner;
}): Promise<false> {
  let lastError = new Error("Failed to disable PR auto-merge");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const armed = await readPrAutoMergeArmed(input);
      if (!armed) {
        return false;
      }
      await input.commandRunner(
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
      if (!(await readPrAutoMergeArmed(input))) {
        return false;
      }
      lastError = new Error(
        `Auto-merge remained enabled on ${input.prUrl} after --disable-auto`,
      );
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError;
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
  if (!input.autoMerge) {
    return ensurePrAutoMergeDisabled({ ...input, commandRunner });
  }

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
