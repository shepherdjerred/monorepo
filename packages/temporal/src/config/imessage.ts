import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";

/**
 * The registry validates the stored handle list (`[]` or up to 20
 * comma-separated handles); this splits it into the handles callers match.
 */
export const ImessageOwnersSchema = flagValueSchema(
  "temporal-agent-chat-photon-owners",
).transform((value) =>
  value === "[]"
    ? []
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
);
function createResolver(onSourceError: () => void) {
  return defineConfig({
    definition: {
      claudeModel: {
        schema: flagValueSchema("temporal-agent-chat-imessage-claude-model"),
        sources: ["flag", "default"],
        default: "claude-opus-5-5",
        names: { flag: "temporal-agent-chat-imessage-claude-model" },
      },
      codexModel: {
        schema: flagValueSchema("temporal-agent-chat-imessage-codex-model"),
        sources: ["flag", "default"],
        default: "gpt-6-luna",
        names: { flag: "temporal-agent-chat-imessage-codex-model" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "temporal-agent-chat-imessage",
        kinds: {
          claudeModel: flagValueKind(
            "temporal-agent-chat-imessage-claude-model",
          ),
          codexModel: flagValueKind("temporal-agent-chat-imessage-codex-model"),
        },
        onUnavailable: onSourceError,
      }),
    },
    hooks: {
      onSourceError: (key, source) => {
        onSourceError();
        console.warn(
          JSON.stringify({
            component: "config.imessage",
            msg: "iMessage configuration source failed",
            key,
            source,
          }),
        );
      },
    },
  });
}

export async function imessageChatModels() {
  let sourceAvailable = true;
  const resolver = createResolver(() => {
    sourceAvailable = false;
  });
  const [claudeModel, codexModel] = await Promise.all([
    resolver.value("claudeModel"),
    resolver.value("codexModel"),
  ]);
  return {
    sourceAvailable,
    claudeModel,
    codexModel,
  };
}
