import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import type { AgentChatProvider } from "#shared/agent/agent-chat.ts";

const DEFINITION = {
  discordClaudeDefaultModel: {
    schema: flagValueSchema("temporal-agent-chat-discord-claude-default-model"),
    sources: ["flag", "default"],
    default: "claude-opus-5-5",
    names: {
      flag: "temporal-agent-chat-discord-claude-default-model",
    },
  },
  discordCodexDefaultModel: {
    schema: flagValueSchema("temporal-agent-chat-discord-codex-default-model"),
    sources: ["flag", "default"],
    default: "gpt-6-luna",
    names: {
      flag: "temporal-agent-chat-discord-codex-default-model",
    },
  },
} as const;

const resolver = defineConfig({
  definition: DEFINITION,
  sources: {
    flag: createFlagConfigSource({
      targetingKey: "temporal-agent-chat-discord",
      kinds: {
        discordClaudeDefaultModel: flagValueKind(
          "temporal-agent-chat-discord-claude-default-model",
        ),
        discordCodexDefaultModel: flagValueKind(
          "temporal-agent-chat-discord-codex-default-model",
        ),
      },
    }),
  },
  hooks: {
    onSourceError: (key, source, message) => {
      console.warn(
        JSON.stringify({
          level: "warning",
          msg: "Agent chat dynamic config source failed",
          component: "config.agent-chat",
          key,
          source,
          error: message,
        }),
      );
    },
  },
});

export async function discordAgentChatDefaultModel(
  provider: AgentChatProvider,
): Promise<string> {
  return provider === "claude"
    ? await resolver.value("discordClaudeDefaultModel")
    : await resolver.value("discordCodexDefaultModel");
}
