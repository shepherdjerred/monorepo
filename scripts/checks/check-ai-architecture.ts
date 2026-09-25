#!/usr/bin/env bun

import path from "node:path";
import { z } from "zod";

import { run } from "../lib/run.ts";

const RootPackageSchema = z.object({
  workspaces: z.array(z.string().min(1)),
});

type ArchitectureRule = Readonly<{
  id: string;
  description: string;
  pattern: RegExp;
}>;

export type ArchitectureSourceFile = Readonly<{
  path: string;
  contents: string;
}>;

export type ArchitectureViolation = Readonly<{
  rule: string;
  description: string;
  path: string;
  line: number;
  source: string;
}>;

const RULES: readonly ArchitectureRule[] = [
  {
    id: "agent-framework",
    description: "Mastra and VoltAgent are not active runtime dependencies",
    pattern: /@(?:mastra|voltagent)\//,
  },
  {
    id: "openrouter",
    description:
      "OpenRouter is retired; inference calls OpenAI, Anthropic, and Google directly through @shepherdjerred/llm-runtime",
    pattern: /@openrouter\/|openrouter\.ai\b|\bOPENROUTER_[A-Z_]+/,
  },
  {
    id: "direct-provider-sdk",
    description:
      "ordinary inference uses @shepherdjerred/llm-runtime, the one place provider SDKs are constructed",
    pattern:
      /(?:(?:from|import\s*\(|require\s*\()\s*["'](?:@ai-sdk\/(?:amazon-bedrock|anthropic|azure|google|google-vertex|groq|mistral|openai|openai-compatible|xai)|@anthropic-ai\/sdk|@google\/(?:genai|generative-ai)|groq-sdk|openai)["']|["'](?:@ai-sdk\/(?:amazon-bedrock|anthropic|azure|google|google-vertex|groq|mistral|openai|openai-compatible|xai)|@anthropic-ai\/sdk|@google\/(?:genai|generative-ai)|groq-sdk|openai)["']\s*:)/,
  },
  {
    id: "provider-api-key",
    description:
      "provider credentials are read by @shepherdjerred/llm-runtime and wired only by reviewed deployment and credential paths",
    pattern:
      /\b(?:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|CODEX_ACCESS_TOKEN|CODEX_API_KEY|GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GROQ_API_KEY|OPENAI_API_KEY|XAI_API_KEY)\b/,
  },
  {
    id: "federation-shadowing-key",
    description:
      "a deployed ANTHROPIC_API_KEY silently outranks workload identity federation; federated workloads must never receive one",
    pattern: /\bANTHROPIC_API_KEY\b/,
  },
  {
    id: "direct-provider-endpoint",
    description:
      "ordinary inference reaches providers through @shepherdjerred/llm-runtime, not a hand-built endpoint",
    pattern:
      /(?:\b(?:ANTHROPIC|GEMINI|GOOGLE_GENERATIVE_AI|GROQ|OPENAI|XAI)_BASE_URL\b|https:\/\/(?:api\.(?:anthropic|groq|openai|x\.ai)\.com|generativelanguage\.googleapis\.com))/,
  },
  {
    id: "legacy-agent-sdk",
    description:
      "deployed coding agents use the Codex SDK, not the Claude Agent SDK",
    pattern:
      /(?:(?:from|import\s*\(|require\s*\()\s*["']@anthropic-ai\/claude-agent-sdk["']|["']@anthropic-ai\/claude-agent-sdk["']\s*:)/,
  },
  {
    id: "agent-cli-dependency",
    description: "Codex integrations use the native SDK package",
    pattern: /@(?:anthropic-ai\/claude-code|openai\/codex)(?:["'@\s]|$)/,
  },
  {
    id: "agent-cli-subprocess",
    description: "Claude and Codex must not be launched as subprocesses",
    pattern:
      /(?:(?:Bun\.)?(?:spawn|spawnSync)|execFile|execFileSync)\s*\(\s*(?:\[\s*)?["'`](?:claude|codex)["'`]/,
  },
  {
    id: "agent-cli-binary-config",
    description: "native agent SDKs must not retain configurable CLI binaries",
    pattern: /\b(?:claude|codex)(?:_|-)?binary\b/i,
  },
];

const CHECK_IMPLEMENTATION_PATHS = new Set([
  "scripts/checks/check-ai-architecture.ts",
  "scripts/checks/check-ai-architecture.test.ts",
]);

const CREDENTIAL_SANITIZER_PATHS = new Set([
  "packages/llm-observability/src/redact.ts",
  "packages/scout-for-lol/packages/data/scripts/patch-analysis.ts",
  "packages/temporal/src/activities/agent/agent-task-env.ts",
  "packages/temporal/src/shared/agent/provider-credentials.ts",
  "scripts/lib/release-refiner.ts",
  // Brim's fish launcher scrubs provider keys from spawned agent sessions
  // (mirroring the user's fish wrappers). It never reads the credentials.
  "packages/toolkit/src/lib/brim/fish.ts",
]);
// pr-fleet scrubs every provider credential from the environment it hands to
// agent subprocesses. It never reads them.
const PR_FLEET_CREDENTIAL_REDACTION_PATH =
  "packages/pr-fleet-controller/src/cli/credential-redaction.ts";
const POKEMON_CODEX_SUBSCRIPTION_PATHS = new Set([
  "packages/discord-plays-pokemon/config.example.toml",
  "packages/discord-plays-pokemon/packages/backend/src/goal/codex/codex-auth.ts",
  "packages/discord-plays-pokemon/packages/backend/src/goal/goal-manager.ts",
  "packages/discord-plays-pokemon/packages/backend/src/goal/goal-runtime-env.ts",
  "packages/homelab/src/cdk8s/src/resources/pokemon.ts",
]);
// The durable Temporal chat primitive intentionally offers both first-party
// coding-agent subscriptions. Credential names are allowed only in the
// reviewed adapters; the manifest exception applies only to the Claude SDK
// dependency declaration.
const DURABLE_AGENT_CREDENTIAL_PATHS = new Set([
  "packages/temporal/src/lib/agent-runner/claude.ts",
  "packages/temporal/src/lib/agent-runner/codex.ts",
]);
const DURABLE_AGENT_CLAUDE_SDK_PATHS = new Set([
  "packages/temporal/package.json",
  "packages/temporal/src/lib/agent-runner/claude.ts",
]);
// These homelab files describe provider-specific OpenTofu resources and their
// credential handoffs. They are infrastructure metadata, not inference paths.
const HOMELAB_PLATFORM_METADATA_PATHS = new Set([
  "packages/homelab/scripts/platform-desired-state.ts",
  "packages/homelab/scripts/tofu/tofu-stack-manifest.ts",
]);

// The shared runtime is the one place a provider SDK is constructed and a
// provider credential is read. Its chokepoint property is what makes catalog
// cost accounting and capability validation reliable for every consumer.
const LLM_RUNTIME_ROOT = "packages/llm-runtime/";
// The Scout review workbench runs in the operator's browser with keys the
// operator pastes in; it cannot use the server-side runtime.
const SCOUT_WORKBENCH_ROOT = "packages/scout-for-lol/packages/frontend/";

// Deployment manifests and bootstrap surfaces that hand each workload its own
// per-app, per-environment provider credential. Anthropic is federated in
// production, so these hold OpenAI and Gemini keys only.
const PROVIDER_CREDENTIAL_WIRING_PATHS = new Set([
  ".buildkite/pipeline.yml",
  ".buildkite/scripts/images/smoke-app-in-image.ts",
  // Wires the per-workload Gemini key and Anthropic federation identifiers
  // that the operator-applied OpenTofu stacks write to 1Password.
  "packages/homelab/src/cdk8s/src/misc/llm-provider-credentials.ts",
  "packages/homelab/src/cdk8s/src/resources/birmel/index.ts",
  "packages/homelab/src/cdk8s/src/resources/temporal/workers/operations-workers.ts",
  "packages/homelab/src/cdk8s/src/resources/temporal/workers/worker.ts",
  "packages/scout-for-lol/dev-web.env.tpl",
  // Justin hands its project key to the Codex SDK inside the agent container.
  "packages/justin-principal-engineer/src/container-entry.ts",
  "packages/justin-principal-engineer/src/host/docker.ts",
  // Operator CLIs document the key they read through providerCredentialsFromEnv.
  "packages/monarch/scripts/match-emails.ts",
  "packages/scout-for-lol/packages/backend/src/league/review/test-reviews.ts",
  "packages/scout-for-lol/packages/backend/src/league/review/test-reviews-utils.ts",
  "packages/temporal/scripts/glitter/run-glitter-context-refresh-local.ts",
  // Browser automation test harness seeds a placeholder for config parsing.
  "packages/birmel/src/agent-tools/tools/automation/test-setup.ts",
]);

// Codex SDK runs and the release refiner authenticate with their own OpenAI
// project key. The Codex SDK takes the key directly, not through llm-runtime.
const CODEX_AND_RELEASE_CREDENTIAL_PATHS = new Set([
  "packages/temporal/src/activities/agent/agent-task-sdk.ts",
  "packages/temporal/src/activities/homelab/homelab-audit-preflight.ts",
  "packages/temporal/src/activities/homelab/homelab-audit.ts",
  "packages/temporal/src/activities/scout/scout-season-refresh-codex.ts",
  "packages/temporal/src/schedules/schedule-definitions.ts",
  "scripts/checks/ci/check-ci-env.ts",
  "scripts/release/release.ts",
]);

// Local-development bootstrap may name a static Anthropic key: CI and local
// runs cannot federate. Nothing deployed may.
function isLocalBootstrapFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename.endsWith(".env.example") || basename === "example.env";
}

const WHISPER_TRANSCRIPTION_ADAPTER =
  "packages/homelab/src/cdk8s/src/resources/torrents/whisperbridge.ts";
// These voice assistants run one OpenAI Realtime turn through the native
// @openai/agents SDK. Realtime's WebSocket transport is not available through
// llm-runtime, so only their named configuration, runtime, and operator-probe
// surfaces may hold the dedicated voice project credential.
const OPENAI_NATIVE_REALTIME_PATHS = new Set([
  "packages/homelab/src/cdk8s/src/resources/streambot/streambot.ts",
  "packages/homelab/src/cdk8s/src/resources/scout/index.ts",
  "packages/streambot/Dockerfile",
  "packages/streambot/scripts/voice-corpus-generate.ts",
  "packages/streambot/scripts/voice-cloud-probe.ts",
  "packages/streambot/scripts/voice-harness.ts",
  "packages/streambot/scripts/voice-model-smoke.ts",
  "packages/streambot/src/config/index.ts",
  "packages/streambot/src/config/schema.ts",
  "packages/scout-for-lol/packages/backend/scripts/smoke/voice-probe.ts",
  "packages/scout-for-lol/packages/backend/src/configuration.ts",
  "packages/scout-for-lol/packages/backend/src/voice-assistant/runtime.ts",
]);
// llm-runtime does not expose OpenAI's speech-to-text or text-to-speech REST
// APIs. Keep that native transport inside the shared voice
// package so application code can only consume the reviewed typed adapter.
const OPENAI_NATIVE_VOICE_AUDIO_PATHS = new Set([
  "packages/voice-assistant/src/openai-audio.ts",
  "packages/voice-assistant/test/openai-audio.test.ts",
]);
const STREAMBOT_VOICE_TTS_PATHS = new Set([
  "packages/streambot/package.json",
  "packages/streambot/src/voice/corpus-generator.ts",
]);
const SUBSCRIPTION_QUOTA_ENDPOINTS =
  "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Providers/ProviderEndpoints.swift";
// Brim's API view reads OpenAI Costs and Anthropic Cost Report as billing
// authorities. This is not an inference path.
const BRIM_API_BILLING_ENDPOINTS =
  "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/APIPlatformEndpoints.swift";
const BRIM_API_BILLING_ALLOWED_URLS = new Set([
  "https://api.openai.com/v1/organization/costs",
  "https://api.anthropic.com/v1/organizations/cost_report",
]);
const DIRECT_PROVIDER_URL =
  /https:\/\/(?:api\.(?:anthropic|groq|openai|x\.ai)\.com|generativelanguage\.googleapis\.com)[^"'\\\s]*/g;
// The billed-cost reconciliation reads the OpenAI Costs/Usage and Anthropic
// Cost Report admin APIs as the payment authority; this is not an inference
// path.
const LLM_BILLING_RECONCILIATION_PATH =
  "packages/temporal/src/shared/llm-billing.ts";
// The federation audience is Anthropic's API origin by definition; the pod
// never calls it from here.
const WORKLOAD_IDENTITY_MANIFEST_PATH =
  "packages/homelab/src/cdk8s/src/misc/llm-provider-credentials.ts";
const NATIVE_SDK_CONTRACT_TEST =
  "scripts/release/release-agent-sdk-contract.test.ts";

function isTestOrFixture(filePath: string): boolean {
  return (
    filePath.includes("/test/") ||
    filePath.includes("/tests/") ||
    filePath.includes("/test-fixtures/") ||
    filePath.includes("/fixtures/") ||
    /\.(?:spec|test)\.[^.]+$/.test(filePath)
  );
}

function brimBillingLineIsAllowed(source: string): boolean {
  const urls = source.match(DIRECT_PROVIDER_URL) ?? [];
  return (
    urls.length > 0 &&
    urls.every((url) =>
      BRIM_API_BILLING_ALLOWED_URLS.has(url.replace(/\/$/, "")),
    )
  );
}

type Exemption = (filePath: string, source: string) => boolean;

function inSet(paths: ReadonlySet<string>): Exemption {
  return (filePath) => paths.has(filePath);
}

function isPath(expected: string): Exemption {
  return (filePath) => filePath === expected;
}

function underRoot(root: string): Exemption {
  return (filePath) => filePath.startsWith(root);
}

const inLlmRuntime = underRoot(LLM_RUNTIME_ROOT);

// Each rule's reviewed exceptions. A rule with no entry has none.
const RULE_EXEMPTIONS: Readonly<Record<string, readonly Exemption[]>> = {
  "federation-shadowing-key": [
    inLlmRuntime,
    isLocalBootstrapFile,
    isTestOrFixture,
    inSet(CREDENTIAL_SANITIZER_PATHS),
    inSet(HOMELAB_PLATFORM_METADATA_PATHS),
    isPath(PR_FLEET_CREDENTIAL_REDACTION_PATH),
  ],
  "provider-api-key": [
    inLlmRuntime,
    isLocalBootstrapFile,
    isTestOrFixture,
    inSet(PROVIDER_CREDENTIAL_WIRING_PATHS),
    inSet(CODEX_AND_RELEASE_CREDENTIAL_PATHS),
    isPath(PR_FLEET_CREDENTIAL_REDACTION_PATH),
    inSet(CREDENTIAL_SANITIZER_PATHS),
    inSet(POKEMON_CODEX_SUBSCRIPTION_PATHS),
    inSet(DURABLE_AGENT_CREDENTIAL_PATHS),
    inSet(HOMELAB_PLATFORM_METADATA_PATHS),
    isPath(WHISPER_TRANSCRIPTION_ADAPTER),
    inSet(OPENAI_NATIVE_REALTIME_PATHS),
  ],
  "direct-provider-sdk": [
    inLlmRuntime,
    underRoot(SCOUT_WORKBENCH_ROOT),
    inSet(STREAMBOT_VOICE_TTS_PATHS),
    isPath("packages/homelab/scripts/platform-desired-state.ts"),
  ],
  "legacy-agent-sdk": [isTestOrFixture, inSet(DURABLE_AGENT_CLAUDE_SDK_PATHS)],
  "direct-provider-endpoint": [
    // Brim's billing file is allowed line by line, only for the two billing
    // URLs; every other exemption names a whole reviewed file.
    (filePath, source) =>
      filePath === BRIM_API_BILLING_ENDPOINTS &&
      brimBillingLineIsAllowed(source),
    inLlmRuntime,
    isTestOrFixture,
    isPath(WHISPER_TRANSCRIPTION_ADAPTER),
    isPath(SUBSCRIPTION_QUOTA_ENDPOINTS),
    isPath(LLM_BILLING_RECONCILIATION_PATH),
    isPath(WORKLOAD_IDENTITY_MANIFEST_PATH),
    inSet(OPENAI_NATIVE_VOICE_AUDIO_PATHS),
  ],
  "agent-cli-dependency": [isPath(NATIVE_SDK_CONTRACT_TEST)],
};

function isAllowedViolation(
  rule: ArchitectureRule,
  filePath: string,
  source: string,
): boolean {
  return (
    CHECK_IMPLEMENTATION_PATHS.has(filePath) ||
    (RULE_EXEMPTIONS[rule.id] ?? []).some((exempt) => exempt(filePath, source))
  );
}

export function findAiArchitectureViolations(
  files: readonly ArchitectureSourceFile[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const file of files) {
    const lines = file.contents.split("\n");
    for (const [lineIndex, source] of lines.entries()) {
      for (const rule of RULES) {
        if (
          rule.pattern.test(source) &&
          !isAllowedViolation(rule, file.path, source)
        ) {
          violations.push({
            rule: rule.id,
            description: rule.description,
            path: file.path,
            line: lineIndex + 1,
            source: source.trim(),
          });
        }
      }
    }
  }
  return violations;
}

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".env",
  ".fish",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".swift",
  ".tmpl",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

export function isTextArchitectureFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return (
    basename === "Dockerfile" ||
    basename === "package.json" ||
    basename.endsWith(".env.example") ||
    basename === "example.env" ||
    TEXT_EXTENSIONS.has(path.extname(filePath))
  );
}

function isActiveRuntimePath(
  filePath: string,
  workspaceRoots: readonly string[],
): boolean {
  return (
    filePath === "package.json" ||
    filePath.startsWith(".buildkite/") ||
    (!filePath.startsWith("packages/docs/") &&
      !filePath.startsWith("packages/dotfiles/dot_agents/skills/") &&
      !filePath.includes("/node_modules/") &&
      !filePath.includes("/dist/") &&
      workspaceRoots.some(
        (workspaceRoot) =>
          filePath === workspaceRoot ||
          filePath.startsWith(`${workspaceRoot}/`),
      ))
  );
}

async function listArchitectureFiles(): Promise<ArchitectureSourceFile[]> {
  const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
  const rootPackage = RootPackageSchema.parse(
    await Bun.file(path.join(repositoryRoot, "package.json")).json(),
  );
  const tracked = await run(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "package.json",
      "packages",
      "scripts",
      ".buildkite",
    ],
    { cwd: repositoryRoot, capture: true, secret: true },
  );
  const paths = tracked.stdout
    .split("\0")
    .filter((filePath) => filePath !== "")
    .filter(
      (filePath) =>
        isActiveRuntimePath(filePath, rootPackage.workspaces) &&
        isTextArchitectureFile(filePath),
    );
  const existing = await Promise.all(
    paths.map(async (filePath) => ({
      exists: await Bun.file(path.join(repositoryRoot, filePath)).exists(),
      path: filePath,
    })),
  );
  const files = await Promise.all(
    existing
      .filter(({ exists }) => exists)
      .map(async ({ path: filePath }) => ({
        path: filePath,
        contents: await Bun.file(path.join(repositoryRoot, filePath)).text(),
      })),
  );
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function checkAiArchitecture(): Promise<void> {
  const files = await listArchitectureFiles();
  const violations = findAiArchitectureViolations(files);
  if (violations.length > 0) {
    throw new Error(
      `AI architecture guard failed:\n${violations
        .map(
          (violation) =>
            `- ${violation.path}:${violation.line.toString()} [${violation.rule}] ${violation.description}: ${violation.source}`,
        )
        .join("\n")}`,
    );
  }
  console.log(
    `AI architecture: ${files.length.toString()} active files satisfy the direct-provider runtime policy`,
  );
}

if (import.meta.main) {
  await checkAiArchitecture();
}
