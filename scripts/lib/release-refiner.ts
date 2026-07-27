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
    api_error_status: z.number().optional(),
    result: z.string().optional(),
  })
  .loose();

const ReleaseRefinerResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("refined"),
      prNumber: z.number().int().positive(),
      packagesRefined: z.array(
        z.enum(["astro-opengraph-images", "webring", "helm-types"]),
      ),
      commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    })
    .strict(),
  z.object({ status: z.literal("no-open-release-pr") }).strict(),
]);

export type RefinerProvider = "claude" | "codex";

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

function requireSuccessfulResult(provider: string, output: string): void {
  if (parseReleaseRefinerResult(output) === null) {
    throw new Error(
      `${provider} release refiner exited 0 without a valid success envelope` +
        (output.trim() === ""
          ? ""
          : `\n--- stdout (tail) ---\n${outputTail(output)}`),
    );
  }
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
): Promise<void> {
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
  requireSuccessfulResult("Codex", result.stdout);
}

export async function runReleaseRefiner(
  input: RunReleaseRefinerInput,
): Promise<RefinerProvider> {
  const execute = input.execute ?? runAllowExit;
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
    requireSuccessfulResult("Claude", parsed.result);
    return "claude";
  }
  if (!isClaudeQuotaExhaustion(claude)) {
    throw commandFailure("Claude", claude);
  }

  console.warn(
    `Claude release refiner quota is exhausted; falling back to Codex ${CODEX_MODEL}.`,
  );
  await runCodex(input, execute);
  return "codex";
}
