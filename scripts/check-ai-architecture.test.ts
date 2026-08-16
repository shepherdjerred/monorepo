import { describe, expect, test } from "bun:test";

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

  test("accepts OpenRouter and native SDK integrations", () => {
    expect(
      findAiArchitectureViolations([
        {
          path: "packages/app/package.json",
          contents: [
            '"@openrouter/ai-sdk-provider": "3.0.0"',
            '"@anthropic-ai/claude-agent-sdk": "0.3.220"',
            '"@openai/codex-sdk": "0.147.0"',
          ].join("\n"),
        },
        {
          path: "packages/app/src/runtime.ts",
          contents:
            "const key = Bun.env.OPENROUTER_API_KEY;\nconst token = Bun.env.CODEX_ACCESS_TOKEN;",
        },
      ]),
    ).toEqual([]);
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
        {
          path: "packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl",
          contents: [
            "env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY",
            "env -u CODEX_API_KEY",
          ].join("\n"),
        },
      ]),
    ).toEqual([]);
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
