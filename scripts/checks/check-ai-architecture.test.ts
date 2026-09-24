import { describe, expect, test } from "vitest";

import {
  findAiArchitectureViolations,
  isTextArchitectureFile,
} from "./check-ai-architecture.ts";

describe("AI architecture guard", () => {
  test("rejects frameworks, direct providers, provider keys, and agent subprocesses", () => {
    const violations = findAiArchitectureViolations([
      {
        path: "packages/app/package.json",
        contents: '"@mastra/core": "1.0.0"\n"openai": "6.0.0"',
      },
      {
        path: "packages/app/src/provider.ts",
        contents:
          'const key = Bun.env.OPENAI_API_KEY;\nconst child = Bun.spawn(["claude", "-p"]);\nconst codexBinary = "codex";',
      },
    ]);

    expect(violations.map(({ rule }) => rule)).toEqual([
      "agent-framework",
      "direct-provider-sdk",
      "provider-api-key",
      "agent-cli-subprocess",
      "agent-cli-binary-config",
    ]);
  });

  test("rejects every OpenRouter surface", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/app/package.json",
          contents: '"@openrouter/ai-sdk-provider": "3.0.0"',
        },
        {
          path: "packages/app/src/runtime.ts",
          contents: [
            "const key = Bun.env.OPENROUTER_API_KEY;",
            'const base = "https://openrouter.ai/api/v1";',
          ].join("\n"),
        },
        {
          // No compatibility path is exempt: the runtime itself must not
          // regrow a router fallback.
          path: "packages/llm-runtime/src/runtime.ts",
          contents:
            'import { createOpenRouter } from "@openrouter/ai-sdk-provider";',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["openrouter", "openrouter", "openrouter", "openrouter"]);
  });

  test("constructs provider SDKs only in llm-runtime and the Scout workbench", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/llm-runtime/package.json",
          contents: '"@ai-sdk/anthropic": "4.0.62"\n"@ai-sdk/openai": "4.0.74"',
        },
        {
          path: "packages/llm-runtime/src/runtime.ts",
          contents: [
            'import { createGoogleGenerativeAI } from "@ai-sdk/google";',
            'const key = Bun.env["GEMINI_API_KEY"];',
            'const token = "https://api.anthropic.com/v1/oauth/token";',
          ].join("\n"),
        },
        {
          path: "packages/scout-for-lol/packages/frontend/src/lib/review-tool/provider-clients.ts",
          contents: 'import { createOpenAI } from "@ai-sdk/openai";',
        },
        {
          path: "packages/app/package.json",
          contents: '"@openai/codex-sdk": "0.147.0"',
        },
      ]),
    ).toEqual([]);

    expect(
      findAiArchitectureViolations([
        {
          path: "packages/scout-for-lol/packages/backend/src/review.ts",
          contents: 'import { createOpenAI } from "@ai-sdk/openai";',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["direct-provider-sdk"]);
  });

  test("never lets a deployed Anthropic key shadow federation", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/homelab/src/cdk8s/src/resources/birmel/index.ts",
          contents: "ANTHROPIC_API_KEY: EnvValue.fromSecretValue(secret)",
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["federation-shadowing-key"]);

    // CI and local development cannot federate, so their bootstrap files may
    // name a static key; so may the runtime that asserts it is absent.
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/birmel/.env.example",
          contents: "# ANTHROPIC_API_KEY=",
        },
        {
          path: "packages/scout-for-lol/packages/backend/example.env",
          contents: "# ANTHROPIC_API_KEY=your-token-here",
        },
        {
          path: "packages/llm-runtime/src/credentials.ts",
          contents: 'const key = Bun.env["ANTHROPIC_API_KEY"];',
        },
      ]),
    ).toEqual([]);
  });

  test("rejects Claude Agent SDK and unapproved subscription authentication", () => {
    const violations = findAiArchitectureViolations([
      {
        path: "packages/app/package.json",
        contents: '"@anthropic-ai/claude-agent-sdk": "0.3.220"',
      },
      {
        path: "packages/app/src/runtime.ts",
        contents:
          "const claude = Bun.env.CLAUDE_CODE_OAUTH_TOKEN;\nconst codex = Bun.env.CODEX_ACCESS_TOKEN;",
      },
    ]);

    expect(violations.map(({ rule }) => rule)).toEqual([
      "legacy-agent-sdk",
      "provider-api-key",
      "provider-api-key",
    ]);
  });

  test("rejects the legacy Claude Agent SDK everywhere", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/justin-principal-engineer/package.json",
          contents: '"@anthropic-ai/claude-agent-sdk": "0.3.270"',
        },
        {
          path: "packages/justin-principal-engineer/src/agent/claude.ts",
          contents:
            'import { query } from "@anthropic-ai/claude-agent-sdk";\nconst token = Bun.env.CLAUDE_CODE_OAUTH_TOKEN;',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["legacy-agent-sdk", "legacy-agent-sdk", "provider-api-key"]);

    expect(
      findAiArchitectureViolations([
        {
          path: "packages/justin-principal-engineer/src/agent/other.ts",
          contents:
            'import { query } from "@anthropic-ai/claude-agent-sdk";\nconst token = Bun.env.CLAUDE_CODE_OAUTH_TOKEN;',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["legacy-agent-sdk", "provider-api-key"]);

    expect(
      findAiArchitectureViolations([
        {
          path: "packages/temporal/package.json",
          contents:
            '"@anthropic-ai/claude-agent-sdk": "0.3.220"\n"CODEX_ACCESS_TOKEN": "must-not-hide"',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["provider-api-key"]);
  });
});

describe("AI architecture compatibility exceptions", () => {
  test("allows native subscriptions only in the durable chat adapters", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/temporal/package.json",
          contents: '"@anthropic-ai/claude-agent-sdk": "0.3.220"',
        },
        {
          path: "packages/temporal/src/lib/agent-runner/claude.ts",
          contents:
            'import { query } from "@anthropic-ai/claude-agent-sdk";\nconst token = Bun.env.CLAUDE_CODE_OAUTH_TOKEN;',
        },
        {
          path: "packages/temporal/src/lib/agent-runner/codex.ts",
          contents: 'delete environment["CODEX_ACCESS_TOKEN"]',
        },
      ]),
    ).toEqual([]);

    expect(
      findAiArchitectureViolations([
        {
          path: "packages/temporal/src/lib/agent-runner/other.ts",
          contents:
            'import { query } from "@anthropic-ai/claude-agent-sdk";\nconst token = Bun.env.CLAUDE_CODE_OAUTH_TOKEN;',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["legacy-agent-sdk", "provider-api-key"]);
  });

  test("includes templated runtime configuration in the scanned file set", () => {
    expect(isTextArchitectureFile("packages/app/config.fish.tmpl")).toBe(true);
  });

  test("keeps non-inference compatibility exceptions narrow", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/temporal/src/activities/agent/agent-task-env.ts",
          contents: 'delete environment["ANTHROPIC_API_KEY"]',
        },
        {
          path: "packages/temporal/src/shared/agent/provider-credentials.ts",
          contents: 'const blocked = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]',
        },
        {
          path: "packages/toolkit/src/lib/brim/fish.ts",
          contents:
            'scrubEnv: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"]',
        },
        {
          path: "packages/app/src/provider.test.ts",
          contents: "expect(environment.OPENAI_API_KEY).toBeUndefined()",
        },
        {
          path: "packages/homelab/src/cdk8s/src/resources/torrents/whisperbridge.ts",
          contents: [
            "OPENAI_API_KEY: secret",
            'OPENAI_BASE_URL: "https://api.groq.com/openai/v1"',
          ].join("\n"),
        },
        {
          path: "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/Providers/ProviderEndpoints.swift",
          contents:
            'let usage = URL(string: "https://api.anthropic.com/api/oauth/usage")',
        },
        {
          path: "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/APIPlatformEndpoints.swift",
          contents:
            'const openai = "https://api.openai.com/v1/organization/costs";\nconst anthropic = "https://api.anthropic.com/v1/organizations/cost_report";',
        },
      ]),
    ).toEqual([]);
  });

  test("allows subscription authentication only for the Pokémon Codex goal workload", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/discord-plays-pokemon/packages/backend/src/goal/codex/codex-auth.ts",
          contents: "const token = Bun.env.CODEX_ACCESS_TOKEN;",
        },
        {
          path: "packages/homelab/src/cdk8s/src/resources/pokemon.ts",
          contents: 'const key = "CODEX_ACCESS_TOKEN";',
        },
      ]),
    ).toEqual([]);

    expect(
      findAiArchitectureViolations([
        {
          path: "packages/discord-plays-pokemon/packages/backend/src/goal/new-agent.ts",
          contents: "const token = Bun.env.CODEX_ACCESS_TOKEN;",
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["provider-api-key"]);
  });
});

describe("AI architecture guard exceptions", () => {
  test("allows native OpenAI Realtime credentials only on named voice surfaces", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/homelab/src/cdk8s/src/resources/scout/index.ts",
          contents: "OPENAI_API_KEY: EnvValue.fromSecretValue(secret)",
        },
        {
          path: "packages/scout-for-lol/packages/backend/src/voice-assistant/runtime.ts",
          contents: "const key = Bun.env.OPENAI_API_KEY;",
        },
      ]),
    ).toEqual([]);
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/scout-for-lol/packages/backend/src/voice-assistant/session.ts",
          contents: "const key = Bun.env.OPENAI_API_KEY;",
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["provider-api-key"]);
  });

  test("allows native OpenAI audio only through the shared voice adapter", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/voice-assistant/src/openai-audio.ts",
          contents:
            'const transcription = "https://api.openai.com/v1/audio/transcriptions";',
        },
        {
          path: "packages/voice-assistant/test/openai-audio.test.ts",
          contents:
            'expect(url).toBe("https://api.openai.com/v1/audio/speech");',
        },
      ]),
    ).toEqual([]);

    expect(
      findAiArchitectureViolations([
        {
          path: "packages/scout-for-lol/packages/backend/src/voice-assistant/new-audio.ts",
          contents: 'const speech = "https://api.openai.com/v1/audio/speech";',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["direct-provider-endpoint"]);
  });

  test("does not turn a broad source path into a provider exception", () => {
    const violations = findAiArchitectureViolations([
      {
        path: "packages/temporal/src/activities/new-provider.ts",
        contents: "const client = Bun.env.ANTHROPIC_API_KEY;",
      },
      {
        path: "packages/homelab/src/cdk8s/src/resources/new-provider.ts",
        contents: 'const endpoint = "https://api.groq.com/openai/v1";',
      },
    ]);
    expect(violations.map(({ rule }) => rule)).toEqual([
      "provider-api-key",
      "federation-shadowing-key",
      "direct-provider-endpoint",
    ]);
  });

  test("allows Brim billing endpoints only in APIPlatformEndpoints.swift", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/OpenAIAPI.swift",
          contents:
            'const costs = "https://api.openai.com/v1/organization/costs";',
        },
        {
          path: "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/AnthropicAPI.swift",
          contents:
            'const report = "https://api.anthropic.com/v1/organizations/cost_report";',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["direct-provider-endpoint", "direct-provider-endpoint"]);
  });

  test("rejects unapproved provider URLs inside APIPlatformEndpoints.swift", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/APIPlatformEndpoints.swift",
          contents:
            'const completions = "https://api.openai.com/v1/chat/completions";',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["direct-provider-endpoint"]);
  });

  test("allows provider billing endpoints only in the billed-cost reconciliation", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/temporal/src/shared/llm-billing.ts",
          contents: [
            'const usage = "https://api.openai.com/v1/organization/usage/completions";',
            'const costs = "https://api.openai.com/v1/organization/costs";',
            'const report = "https://api.anthropic.com/v1/organizations/cost_report";',
          ].join("\n"),
        },
      ]),
    ).toEqual([]);
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/temporal/src/shared/openai-usage.ts",
          contents:
            'const usage = "https://api.openai.com/v1/organization/usage/completions";',
        },
      ]).map(({ rule }) => rule),
    ).toEqual(["direct-provider-endpoint"]);
  });
});
