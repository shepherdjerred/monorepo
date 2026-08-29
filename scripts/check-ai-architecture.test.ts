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

  test("accepts OpenRouter and Codex SDK integrations", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/app/package.json",
          contents: [
            '"@openrouter/ai-sdk-provider": "3.0.0"',
            '"@openai/codex-sdk": "0.147.0"',
          ].join("\n"),
        },
        {
          path: "packages/app/src/runtime.ts",
          contents: "const key = Bun.env.OPENROUTER_API_KEY;",
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

  test("includes templated runtime configuration in the scanned file set", () => {
    expect(isTextArchitectureFile("packages/app/config.fish.tmpl")).toBe(true);
  });

  test("keeps non-inference compatibility exceptions narrow", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/temporal/src/activities/agent-task-env.ts",
          contents: 'delete environment["ANTHROPIC_API_KEY"]',
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
          path: "packages/macos-ai-subscription-tracker/Sources/QuotaBarCore/ProviderEndpoints.swift",
          contents:
            'let usage = URL(string: "https://api.anthropic.com/api/oauth/usage")',
        },
      ]),
    ).toEqual([]);
  });

  test("allows subscription authentication only for the Pokémon Codex goal workload", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/discord-plays-pokemon/packages/backend/src/goal/codex-auth.ts",
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
      "direct-provider-endpoint",
    ]);
  });
});
