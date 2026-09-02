#!/usr/bin/env bun

import path from "node:path";
import { z } from "zod";

import { run } from "./lib/run.ts";

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
    id: "direct-provider-sdk",
    description:
      "ordinary inference uses @shepherdjerred/llm-runtime, not a direct provider SDK",
    pattern:
      /(?:(?:from|import\s*\(|require\s*\()\s*["'](?:@ai-sdk\/(?:amazon-bedrock|anthropic|azure|google|google-vertex|groq|mistral|openai|openai-compatible|xai)|@anthropic-ai\/sdk|@google\/(?:genai|generative-ai)|groq-sdk|openai)["']|["'](?:@ai-sdk\/(?:amazon-bedrock|anthropic|azure|google|google-vertex|groq|mistral|openai|openai-compatible|xai)|@anthropic-ai\/sdk|@google\/(?:genai|generative-ai)|groq-sdk|openai)["']\s*:)/,
  },
  {
    id: "provider-api-key",
    description:
      "deployed inference credentials use OpenRouter except for the explicit Pokémon Codex subscription workload",
    pattern:
      /\b(?:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|CODEX_ACCESS_TOKEN|CODEX_API_KEY|GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GROQ_API_KEY|OPENAI_API_KEY|XAI_API_KEY)\b/,
  },
  {
    id: "direct-provider-endpoint",
    description:
      "ordinary inference must not target a provider endpoint directly",
    pattern:
      /(?:\b(?:ANTHROPIC|GEMINI|GOOGLE_GENERATIVE_AI|GROQ|OPENAI|XAI)_BASE_URL\b|https:\/\/(?:api\.(?:anthropic|groq|openai|x\.ai)\.com|generativelanguage\.googleapis\.com))/,
  },
  {
    id: "legacy-agent-sdk",
    description:
      "deployed coding agents use the Codex SDK through OpenRouter, not the Claude Agent SDK",
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
  "scripts/check-ai-architecture.ts",
  "scripts/check-ai-architecture.test.ts",
]);

const CREDENTIAL_SANITIZER_PATHS = new Set([
  "packages/llm-observability/src/redact.ts",
  "packages/scout-for-lol/packages/data/scripts/patch-analysis.ts",
  "packages/temporal/src/activities/agent-task-env.ts",
  "scripts/lib/release-refiner.ts",
]);
const POKEMON_CODEX_SUBSCRIPTION_PATHS = new Set([
  "packages/discord-plays-pokemon/config.example.toml",
  "packages/discord-plays-pokemon/packages/backend/src/goal/codex-auth.ts",
  "packages/discord-plays-pokemon/packages/backend/src/goal/goal-manager.ts",
  "packages/discord-plays-pokemon/packages/backend/src/goal/goal-runtime-env.ts",
  "packages/homelab/src/cdk8s/src/resources/pokemon.ts",
]);

// These homelab files describe provider-specific OpenTofu resources and their
// credential handoffs. They are infrastructure metadata, not inference paths.
const HOMELAB_PLATFORM_METADATA_PATHS = new Set([
  "packages/homelab/scripts/platform-desired-state.ts",
  "packages/homelab/scripts/tofu-stack-manifest.ts",
]);

const WHISPER_TRANSCRIPTION_ADAPTER =
  "packages/homelab/src/cdk8s/src/resources/torrents/whisperbridge.ts";
// Streambot's voice assistant runs on OpenAI's native agent SDK (@openai/agents Realtime) with a
// dedicated project key — the sanctioned native-SDK credential class — and its corpus tooling
// speaks to OpenAI TTS. Neither the Realtime WebSocket nor TTS is routable through
// OpenRouter/llm-runtime, so these named surfaces hold the credential and the direct SDK.
const STREAMBOT_VOICE_REALTIME_PATHS = new Set([
  "packages/homelab/src/cdk8s/src/resources/streambot.ts",
  "packages/streambot/Dockerfile",
  "packages/streambot/scripts/voice-corpus-generate.ts",
  "packages/streambot/scripts/voice-harness.ts",
  "packages/streambot/scripts/voice-model-smoke.ts",
  "packages/streambot/src/config/index.ts",
  "packages/streambot/src/config/schema.ts",
]);
const STREAMBOT_VOICE_TTS_PATHS = new Set([
  "packages/streambot/package.json",
  "packages/streambot/src/voice/corpus-generator.ts",
]);
const SUBSCRIPTION_QUOTA_ENDPOINTS =
  "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/ProviderEndpoints.swift";
// The billing monitor uses OpenAI's official organization Usage and Costs APIs
// as the payment authority; this is not an inference path.
const OPENAI_BILLING_RECONCILIATION_PATH =
  "packages/temporal/src/shared/openai-complimentary-usage.ts";
const NATIVE_SDK_CONTRACT_TEST = "scripts/release-agent-sdk-contract.test.ts";

function isTestOrFixture(filePath: string): boolean {
  return (
    filePath.includes("/test/") ||
    filePath.includes("/tests/") ||
    filePath.includes("/test-fixtures/") ||
    filePath.includes("/fixtures/") ||
    /\.(?:spec|test)\.[^.]+$/.test(filePath)
  );
}

function isAllowedViolation(rule: ArchitectureRule, filePath: string): boolean {
  if (CHECK_IMPLEMENTATION_PATHS.has(filePath)) return true;

  if (rule.id === "provider-api-key") {
    return (
      isTestOrFixture(filePath) ||
      CREDENTIAL_SANITIZER_PATHS.has(filePath) ||
      POKEMON_CODEX_SUBSCRIPTION_PATHS.has(filePath) ||
      HOMELAB_PLATFORM_METADATA_PATHS.has(filePath) ||
      filePath === WHISPER_TRANSCRIPTION_ADAPTER ||
      STREAMBOT_VOICE_REALTIME_PATHS.has(filePath)
    );
  }

  if (rule.id === "direct-provider-sdk") {
    return (
      STREAMBOT_VOICE_TTS_PATHS.has(filePath) ||
      filePath === "packages/homelab/scripts/platform-desired-state.ts"
    );
  }

  if (rule.id === "legacy-agent-sdk") {
    return isTestOrFixture(filePath);
  }

  if (rule.id === "direct-provider-endpoint") {
    return (
      filePath === WHISPER_TRANSCRIPTION_ADAPTER ||
      filePath === SUBSCRIPTION_QUOTA_ENDPOINTS ||
      filePath === OPENAI_BILLING_RECONCILIATION_PATH
    );
  }

  if (rule.id === "agent-cli-dependency") {
    return filePath === NATIVE_SDK_CONTRACT_TEST;
  }

  return false;
}

export function findAiArchitectureViolations(
  files: readonly ArchitectureSourceFile[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const file of files) {
    const lines = file.contents.split("\n");
    for (const [lineIndex, source] of lines.entries()) {
      for (const rule of RULES) {
        if (rule.pattern.test(source) && !isAllowedViolation(rule, file.path)) {
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
  if (filePath === "package.json" || filePath.startsWith(".buildkite/")) {
    return true;
  }
  if (filePath.startsWith("packages/docs/")) return false;
  if (filePath.startsWith("packages/dotfiles/dot_agents/skills/")) return false;
  if (filePath.includes("/node_modules/") || filePath.includes("/dist/")) {
    return false;
  }
  return workspaceRoots.some(
    (workspaceRoot) =>
      filePath === workspaceRoot || filePath.startsWith(`${workspaceRoot}/`),
  );
}

async function listArchitectureFiles(): Promise<ArchitectureSourceFile[]> {
  const repositoryRoot = path.resolve(import.meta.dir, "..");
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
    `AI architecture: ${files.length.toString()} active files satisfy the OpenRouter/native SDK policy`,
  );
}

if (import.meta.main) {
  await checkAiArchitecture();
}
