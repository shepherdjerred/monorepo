import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { z } from "zod";

import { runAllowExit, type RunOptions, type RunResult } from "./run.ts";

const CODEX_MODEL = "gpt-5.6-sol";
// Every inference credential the release lane's environment may carry. The
// refiner strips all of them and hands back only the one provider it is about
// to launch, so neither agent can reach the other's subscription.
const AGENT_CREDENTIAL_ENVIRONMENT = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_ACCESS_TOKEN",
  "CODEX_ACCOUNT_ID",
  "CODEX_API_KEY",
  "CODEX_ID_TOKEN",
  "CODEX_REFRESH_TOKEN",
  "OPENAI_API_KEY",
];
const AGENT_CREDENTIAL_ENVIRONMENT_KEYS = new Set(AGENT_CREDENTIAL_ENVIRONMENT);
const OUTPUT_TAIL_LIMIT = 16_384;
const CLAUDE_QUOTA_PATTERN =
  /\b(?:hit|reached|exceeded) (?:your )?(?:weekly|monthly|usage)(?: usage)? limit\b/i;
const REFINER_RESULT_START = "<!-- release-refiner-result -->";
const REFINER_RESULT_END = "<!-- /release-refiner-result -->";

const ClaudeResultSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string(),
    is_error: z.boolean(),
    api_error_status: z.number().nullish(),
    result: z.string().optional(),
    errors: z.array(z.string()).optional(),
    total_cost_usd: z.number().optional(),
    num_turns: z.number().int().nonnegative().optional(),
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
  codexAccessToken: string;
  execute?: RefinerCommandRunner;
  runClaude?: ReleaseAgentRunner;
  runCodex?: ReleaseAgentRunner;
};

export type ReleaseAgentOutcome =
  | { kind: "completed"; output: string }
  | { kind: "quota-exhausted"; detail: string };

export type ReleaseAgentRunner = (
  input: RunReleaseRefinerInput,
) => Promise<ReleaseAgentOutcome>;

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

export function isClaudeQuotaExhaustion(result: unknown): boolean {
  const parsed = ClaudeResultSchema.safeParse(result);
  if (!parsed.success) return false;
  const detail = [parsed.data.result, ...(parsed.data.errors ?? [])]
    .filter((value) => value !== undefined)
    .join("; ");
  return (
    parsed.data.is_error &&
    parsed.data.api_error_status === 429 &&
    CLAUDE_QUOTA_PATTERN.test(detail)
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

/**
 * Build a native SDK environment for the release refiner.
 *
 * Both SDKs replace the child environment wholesale rather than layering onto
 * `process.env` the way `run()` does, so passing only the git-auth env would
 * drop the CI image's mise `PATH` — and Claude is launched with
 * `executable: "bun"`, which is only resolvable through that PATH. Preserve the
 * process environment, strip every inference credential, then add back the git
 * auth and the single provider credential this run needs.
 */
export function refinerSdkEnv(
  input: Pick<RunReleaseRefinerInput, "env">,
  credentials: Readonly<Record<string, string>>,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string") continue;
    if (AGENT_CREDENTIAL_ENVIRONMENT_KEYS.has(key)) continue;
    env[key] = value;
  }
  return { ...env, ...input.env, ...credentials };
}

async function runClaudeAgentSdk(
  input: RunReleaseRefinerInput,
): Promise<ReleaseAgentOutcome> {
  const messages = query({
    prompt: input.prompt,
    options: {
      allowedTools: ["Bash", "Read", "Edit", "Write", "Grep", "Glob"],
      allowDangerouslySkipPermissions: true,
      cwd: input.root,
      env: refinerSdkEnv(input, {
        CLAUDE_CODE_OAUTH_TOKEN: input.claudeToken,
        IS_SANDBOX: "1",
      }),
      executable: "bun",
      maxTurns: 80,
      model: "claude-opus-5",
      permissionMode: "bypassPermissions",
      persistSession: false,
      tools: ["Bash", "Read", "Edit", "Write", "Grep", "Glob"],
    },
  });
  let result: z.infer<typeof ClaudeResultSchema> | undefined;
  try {
    for await (const message of messages) {
      if (message.type === "result") {
        result = ClaudeResultSchema.parse(message);
      }
    }
  } finally {
    messages.close();
  }
  if (result === undefined) {
    throw new Error("Claude Agent SDK completed without a result event");
  }
  if (isClaudeQuotaExhaustion(result)) {
    return {
      kind: "quota-exhausted",
      detail: result.result ?? result.errors?.join("; ") ?? "usage limit",
    };
  }
  if (result.is_error || result.subtype !== "success") {
    throw new Error(
      `Claude release refiner failed: ${result.errors?.join("; ") ?? result.result ?? result.subtype}`,
    );
  }
  if (result.result === undefined) {
    throw new Error("Claude release refiner returned no result text");
  }
  console.log(
    `Claude release refiner completed (${String(result.num_turns ?? 0)} turns, $${(result.total_cost_usd ?? 0).toFixed(4)}).`,
  );
  return { kind: "completed", output: result.result };
}

async function runCodexSdk(
  input: RunReleaseRefinerInput,
): Promise<ReleaseAgentOutcome> {
  const codex = new Codex({
    env: refinerSdkEnv(input, {
      CODEX_ACCESS_TOKEN: input.codexAccessToken,
    }),
    config: {
      project_doc_max_bytes: 0,
      features: { apps: false, plugins: false, multi_agent: false },
    },
  });
  const thread = codex.startThread({
    approvalPolicy: "never",
    model: CODEX_MODEL,
    modelReasoningEffort: "medium",
    networkAccessEnabled: true,
    sandboxMode: "danger-full-access",
    skipGitRepoCheck: true,
    webSearchMode: "disabled",
    workingDirectory: input.root,
  });
  const result = await thread.run(input.prompt);
  console.log(
    `Codex release refiner completed (${String(result.usage?.input_tokens ?? 0)} input tokens, ${String(result.usage?.output_tokens ?? 0)} output tokens).`,
  );
  return { kind: "completed", output: result.finalResponse };
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
    unsetEnv: AGENT_CREDENTIAL_ENVIRONMENT,
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

  const claude = await (input.runClaude ?? runClaudeAgentSdk)(input);
  if (claude.kind === "completed") {
    const result = requireSuccessfulResult("Claude", claude.output);
    await verifyReleaseRefinerResult(input, result, execute);
    return "claude";
  }

  console.warn(
    `Claude release refiner quota is exhausted; falling back to Codex ${CODEX_MODEL}.`,
  );
  const codex = await (input.runCodex ?? runCodexSdk)(input);
  if (codex.kind !== "completed") {
    throw new Error("Codex release refiner unexpectedly reported quota status");
  }
  const result = requireSuccessfulResult("Codex", codex.output);
  await verifyReleaseRefinerResult(input, result, execute);
  return "codex";
}
