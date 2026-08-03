import { z } from "zod";

import { runAllowExit, type RunOptions, type RunResult } from "./run.ts";

const CODEX_MODEL = "gpt-5.6-sol";
const OUTPUT_TAIL_LIMIT = 16_384;
const CLAUDE_QUOTA_PATTERN =
  /\b(?:hit|reached|exceeded) (?:your )?(?:weekly|monthly|usage)(?: usage)? limit\b/i;
const REFINER_RESULT_START = "<!-- release-refiner-result -->";
const REFINER_RESULT_END = "<!-- /release-refiner-result -->";

const ClaudeResultSchema = z
  .object({
    is_error: z.boolean(),
    // The CLI emits `api_error_status: null` on a successful (non-error) result,
    // so this must accept null — `.optional()` (number | undefined) rejects it and
    // silently fails parsing of an otherwise-valid success payload. It is only read
    // as `=== 429` on a non-zero exit (see isClaudeQuotaExhaustion).
    api_error_status: z.number().nullish(),
    result: z.string().optional(),
  })
  .loose();

const ReleaseRefinerResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("refined"),
      prNumber: z.number().int().positive(),
      packagesRefined: z
        .array(z.enum(["astro-opengraph-images", "webring", "helm-types"]))
        .min(1)
        .refine(
          (packages) => new Set(packages).size === packages.length,
          "packagesRefined must contain unique package names",
        ),
      commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    })
    .strict(),
  z.object({ status: z.literal("no-open-release-pr") }).strict(),
]);
const ReleasePrSchema = z
  .object({
    number: z.number().int().positive(),
    state: z.literal("OPEN"),
    baseRefName: z.literal("main"),
    headRefName: z.literal("release-please--branches--main"),
    headRefOid: z.string().regex(/^[0-9a-f]{40}$/),
    labels: z.array(z.object({ name: z.string() }).loose()),
    body: z.string(),
  })
  .loose();
const OpenReleasePrSchema = z.array(
  z.object({ number: z.number().int().positive() }).loose(),
);
const RefinerCommitSchema = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    commit: z
      .object({
        author: z.object({
          name: z.literal("release-please-refiner[bot]"),
          email: z.literal("release-please-refiner@users.noreply.github.com"),
        }),
        message: z.string(),
      })
      .loose(),
    files: z.array(z.object({ filename: z.string() }).loose()),
  })
  .loose();

export type RefinerProvider = "claude" | "codex" | "none";

export type RefinerCommandRunner = (
  command: string[],
  options: RunOptions,
) => Promise<RunResult>;

export type RunReleaseRefinerInput = {
  root: string;
  prompt: string;
  env: Record<string, string>;
  claudeToken: string;
  openAiApiKey: string;
  execute?: RefinerCommandRunner;
};

function claudeCommand(prompt: string): string[] {
  return [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--allowed-tools",
    "Bash,Read,Edit,Write,Grep,Glob",
    "--dangerously-skip-permissions",
    "--max-turns",
    "80",
    "--model",
    "claude-opus-5",
  ];
}

function codexCommand(prompt: string, root: string): string[] {
  return [
    "bun",
    "--no-install",
    "run",
    "--cwd",
    "scripts",
    "release-refiner:codex",
    "--",
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--ignore-user-config",
    "--ignore-rules",
    "--disable",
    "apps",
    "--disable",
    "plugins",
    "--disable",
    "multi_agent",
    "--ephemeral",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--cd",
    root,
    "--model",
    CODEX_MODEL,
    "--config",
    'model_reasoning_effort="medium"',
    prompt,
  ];
}

function parseClaudeResult(
  stdout: string,
): z.infer<typeof ClaudeResultSchema> | null {
  const trimmed = stdout.trim();
  if (trimmed === "") return null;
  try {
    const raw: unknown = JSON.parse(trimmed);
    const parsed = ClaudeResultSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    // Malformed output is never a fallback signal. The original command
    // failure propagates below, preserving fail-closed behavior.
    return null;
  }
}

function parseReleaseRefinerResult(
  output: string,
): z.infer<typeof ReleaseRefinerResultSchema> | null {
  let envelope: string | null = null;
  let offset = 0;
  for (;;) {
    const start = output.indexOf(REFINER_RESULT_START, offset);
    if (start === -1) break;
    const contentStart = start + REFINER_RESULT_START.length;
    const end = output.indexOf(REFINER_RESULT_END, contentStart);
    if (end === -1) return null;
    envelope = output.slice(contentStart, end).trim();
    offset = end + REFINER_RESULT_END.length;
  }
  if (envelope === null) return null;
  try {
    const raw: unknown = JSON.parse(envelope);
    const parsed = ReleaseRefinerResultSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isClaudeQuotaExhaustion(result: RunResult): boolean {
  if (result.exitCode === 0) return false;
  const parsed = parseClaudeResult(result.stdout);
  return (
    parsed?.is_error === true &&
    parsed.api_error_status === 429 &&
    parsed.result !== undefined &&
    CLAUDE_QUOTA_PATTERN.test(parsed.result)
  );
}

function outputTail(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= OUTPUT_TAIL_LIMIT
    ? trimmed
    : trimmed.slice(-OUTPUT_TAIL_LIMIT);
}

function requireSuccessfulResult(
  provider: string,
  output: string,
): z.infer<typeof ReleaseRefinerResultSchema> {
  const result = parseReleaseRefinerResult(output);
  if (result === null) {
    throw new Error(
      `${provider} release refiner exited 0 without a valid success envelope` +
        (output.trim() === ""
          ? ""
          : `\n--- stdout (tail) ---\n${outputTail(output)}`),
    );
  }
  return result;
}

function commandFailure(provider: string, result: RunResult): Error {
  const stdout = outputTail(result.stdout);
  const stderr = outputTail(result.stderr);
  const details = [
    stdout === "" ? null : `--- stdout (tail) ---\n${stdout}`,
    stderr === "" ? null : `--- stderr (tail) ---\n${stderr}`,
  ].filter((detail) => detail !== null);
  return new Error(
    `${provider} release refiner failed (exit ${result.exitCode.toString()})` +
      (details.length === 0 ? "" : `\n${details.join("\n")}`),
  );
}

async function runCodex(
  input: RunReleaseRefinerInput,
  execute: RefinerCommandRunner,
): Promise<z.infer<typeof ReleaseRefinerResultSchema>> {
  const result = await execute(codexCommand(input.prompt, input.root), {
    cwd: input.root,
    capture: true,
    env: {
      ...input.env,
      CODEX_API_KEY: input.openAiApiKey,
    },
    unsetEnv: [
      "OPENAI_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "CODEX_REFRESH_TOKEN",
      "CODEX_ID_TOKEN",
      "CODEX_ACCOUNT_ID",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
    ],
  });
  if (result.exitCode !== 0) {
    throw commandFailure("Codex", result);
  }
  return requireSuccessfulResult("Codex", result.stdout);
}

function packageChangelog(
  packageName: "astro-opengraph-images" | "webring" | "helm-types",
): string {
  switch (packageName) {
    case "astro-opengraph-images":
      return "packages/astro-opengraph-images/CHANGELOG.md";
    case "webring":
      return "packages/webring/CHANGELOG.md";
    case "helm-types":
      return "packages/homelab/src/helm-types/CHANGELOG.md";
  }
}

async function verifiedCommand(
  input: RunReleaseRefinerInput,
  execute: RefinerCommandRunner,
  command: string[],
): Promise<string> {
  const result = await execute(command, {
    cwd: input.root,
    capture: true,
    env: input.env,
    unsetEnv: [
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "CODEX_REFRESH_TOKEN",
      "CODEX_ID_TOKEN",
      "CODEX_ACCOUNT_ID",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
    ],
  });
  if (result.exitCode !== 0) {
    throw commandFailure("Release refiner verification", result);
  }
  return result.stdout;
}

async function listOpenReleasePrs(
  input: RunReleaseRefinerInput,
  execute: RefinerCommandRunner,
): Promise<z.infer<typeof OpenReleasePrSchema>> {
  const stdout = await verifiedCommand(input, execute, [
    "gh",
    "pr",
    "list",
    "--repo",
    "shepherdjerred/monorepo",
    "--base",
    "main",
    "--label",
    "autorelease: pending",
    "--state",
    "open",
    "--json",
    "number",
    "--limit",
    "1",
  ]);
  const raw: unknown = JSON.parse(stdout);
  return OpenReleasePrSchema.parse(raw);
}

async function verifyReleaseRefinerResult(
  input: RunReleaseRefinerInput,
  result: z.infer<typeof ReleaseRefinerResultSchema>,
  execute: RefinerCommandRunner,
): Promise<void> {
  if (result.status === "no-open-release-pr") {
    const openReleasePrs = await listOpenReleasePrs(input, execute);
    if (openReleasePrs.length > 0) {
      throw new Error(
        "Release refiner reported no open release PR, but GitHub has one",
      );
    }
    return;
  }

  const prStdout = await verifiedCommand(input, execute, [
    "gh",
    "pr",
    "view",
    result.prNumber.toString(),
    "--repo",
    "shepherdjerred/monorepo",
    "--json",
    "number,state,baseRefName,headRefName,headRefOid,labels,body",
  ]);
  const releasePr = ReleasePrSchema.parse(JSON.parse(prStdout));
  if (
    releasePr.number !== result.prNumber ||
    releasePr.headRefOid !== result.commitSha ||
    !releasePr.labels.some((label) => label.name === "autorelease: pending")
  ) {
    throw new Error(
      "Release refiner result does not match the open pending release PR head",
    );
  }

  const commitStdout = await verifiedCommand(input, execute, [
    "gh",
    "api",
    `repos/shepherdjerred/monorepo/commits/${result.commitSha}`,
  ]);
  const commit = RefinerCommitSchema.parse(JSON.parse(commitStdout));
  const expectedFiles = new Set(
    result.packagesRefined.map((packageName) => packageChangelog(packageName)),
  );
  const actualFiles = new Set(commit.files.map((file) => file.filename));
  if (
    commit.sha !== result.commitSha ||
    !/^chore\(root\): refine release notes for \d{4}-\d{2}-\d{2}(?:\n|$)/.test(
      commit.commit.message,
    ) ||
    actualFiles.size !== expectedFiles.size ||
    [...actualFiles].some((file) => !expectedFiles.has(file)) ||
    result.packagesRefined.some(
      (packageName) =>
        !releasePr.body.includes(`<details><summary>${packageName}:`),
    )
  ) {
    throw new Error(
      "Release refiner result does not match the remote refiner commit and PR body",
    );
  }
}

export async function runReleaseRefiner(
  input: RunReleaseRefinerInput,
): Promise<RefinerProvider> {
  const execute = input.execute ?? runAllowExit;
  const openReleasePrs = await listOpenReleasePrs(input, execute);
  if (openReleasePrs.length === 0) {
    return "none";
  }

  const claude = await execute(claudeCommand(input.prompt), {
    cwd: input.root,
    capture: true,
    env: {
      ...input.env,
      CLAUDE_CODE_OAUTH_TOKEN: input.claudeToken,
      IS_SANDBOX: "1",
    },
    unsetEnv: [
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "CODEX_REFRESH_TOKEN",
      "CODEX_ID_TOKEN",
      "CODEX_ACCOUNT_ID",
      "ANTHROPIC_API_KEY",
    ],
  });
  if (claude.exitCode === 0) {
    const parsed = parseClaudeResult(claude.stdout);
    if (parsed === null || parsed.is_error || parsed.result === undefined) {
      throw new Error(
        "Claude release refiner exited 0 without a valid non-error JSON result" +
          (claude.stdout.trim() === ""
            ? ""
            : `\n--- stdout (tail) ---\n${outputTail(claude.stdout)}`),
      );
    }
    const result = requireSuccessfulResult("Claude", parsed.result);
    await verifyReleaseRefinerResult(input, result, execute);
    return "claude";
  }
  if (!isClaudeQuotaExhaustion(claude)) {
    throw commandFailure("Claude", claude);
  }

  console.warn(
    `Claude release refiner quota is exhausted; falling back to Codex ${CODEX_MODEL}.`,
  );
  const result = await runCodex(input, execute);
  await verifyReleaseRefinerResult(input, result, execute);
  return "codex";
}
