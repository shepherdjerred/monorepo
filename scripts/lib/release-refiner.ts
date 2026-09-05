import { Codex } from "@openai/codex-sdk";
import { createOpenRouterCodexConfig } from "@shepherdjerred/llm-runtime";
import { z } from "zod";

import { runAllowExit, type RunOptions, type RunResult } from "./run.ts";

const CODEX_MODEL = "gpt-5.6-luna";
// Every inference credential the release lane's environment may carry. The
// refiner strips all of them before independently verifying the agent result.
const AGENT_CREDENTIAL_ENVIRONMENT = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_ACCESS_TOKEN",
  "CODEX_ACCOUNT_ID",
  "CODEX_API_KEY",
  "CODEX_ID_TOKEN",
  "CODEX_REFRESH_TOKEN",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];
const OUTPUT_TAIL_LIMIT = 16_384;
const REFINER_RESULT_START = "<!-- release-refiner-result -->";
const REFINER_RESULT_END = "<!-- /release-refiner-result -->";

const ReleaseRefinerResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("refined"),
      prNumber: z.number().int().positive(),
      packagesRefined: z
        .array(
          z.enum([
            "astro-opengraph-images",
            "webring",
            "helm-types",
            "home-assistant",
          ]),
        )
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

export type RefinerProvider = "codex" | "none";

export type RefinerCommandRunner = (
  command: string[],
  options: RunOptions,
) => Promise<RunResult>;

export type RunReleaseRefinerInput = {
  root: string;
  prompt: string;
  env: Record<string, string>;
  openRouterApiKey: string;
  execute?: RefinerCommandRunner;
  runCodex?: ReleaseAgentRunner;
};

export type ReleaseAgentOutcome = { kind: "completed"; output: string };

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
 * Non-secret process and TLS settings the refiner agents inherit from the CI
 * image. This is an allowlist, not a denylist, for the same reason
 * `envForProvider` is one in packages/temporal: this agent runs with Bash and
 * network access, so anything reachable from their environment is exfiltratable
 * by a prompt-injected or merely mistaken command. The main-only release lane
 * runs with `GITHUB_APP_PRIVATE_KEY` set — `setupGitAuth()` requires it — so a
 * denylist of inference credentials would hand the agent a long-lived GitHub
 * App key it has no use for, along with every other CI secret nobody thought to
 * enumerate. The agent needs `PATH`, TLS/proxy settings, the minted `GH_TOKEN`
 * askpass environment, and its own provider credential; nothing else.
 */
const AGENT_PROCESS_ENVIRONMENT_KEYS = new Set([
  // Codex is launched from the CI image's mise-aware PATH.
  "PATH",
  "HOME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "LANG",
  "LC_ALL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

/**
 * Build a native SDK environment for the release refiner.
 *
 * The SDK replaces the child environment wholesale rather than layering onto
 * `process.env` the way `run()` does, so passing only the git-auth env would
 * drop the CI image's mise `PATH`. Copy only the allowlisted process/TLS
 * settings, then add the git auth this run needs. The OpenRouter key is passed
 * through the Codex SDK constructor and never inherited by tool subprocesses.
 */
export function refinerSdkEnv(
  input: Pick<RunReleaseRefinerInput, "env">,
  credentials: Readonly<Record<string, string>>,
  sourceEnv: Readonly<Record<string, string | undefined>> = Bun.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value !== "string") continue;
    if (!AGENT_PROCESS_ENVIRONMENT_KEYS.has(key)) continue;
    env[key] = value;
  }
  return { ...env, ...input.env, ...credentials };
}

async function runCodexSdk(
  input: RunReleaseRefinerInput,
): Promise<ReleaseAgentOutcome> {
  const openRouter = createOpenRouterCodexConfig({
    apiKey: input.openRouterApiKey,
    modelId: CODEX_MODEL,
    env: refinerSdkEnv(input, {}),
  });
  const codex = new Codex({
    ...openRouter.codexOptions,
    config: {
      project_doc_max_bytes: 0,
      features: { apps: false, plugins: false, multi_agent: false },
    },
  });
  const thread = codex.startThread({
    approvalPolicy: "never",
    model: openRouter.routeModelId,
    modelReasoningEffort: "medium",
    networkAccessEnabled: true,
    sandboxMode: "danger-full-access",
    skipGitRepoCheck: true,
    webSearchMode: "disabled",
    workingDirectory: input.root,
  });
  const result = await thread.run(input.prompt);
  console.log(
    `Codex release refiner completed (model=${openRouter.catalogModelId}, ${String(result.usage?.input_tokens ?? 0)} input tokens, ${String(result.usage?.output_tokens ?? 0)} output tokens).`,
  );
  return { kind: "completed", output: result.finalResponse };
}

function packageChangelog(
  packageName:
    "astro-opengraph-images" | "webring" | "helm-types" | "home-assistant",
): string {
  switch (packageName) {
    case "astro-opengraph-images":
      return "packages/astro-opengraph-images/CHANGELOG.md";
    case "webring":
      return "packages/webring/CHANGELOG.md";
    case "helm-types":
      return "packages/homelab/src/helm-types/CHANGELOG.md";
    case "home-assistant":
      return "packages/home-assistant/CHANGELOG.md";
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

  const codex = await (input.runCodex ?? runCodexSdk)(input);
  const result = requireSuccessfulResult("Codex", codex.output);
  await verifyReleaseRefinerResult(input, result, execute);
  return "codex";
}
