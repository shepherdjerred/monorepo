import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod/v4";

export const ImessageOwnersSchema = z
  .string()
  .transform((value) =>
    value === "[]"
      ? []
      : value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== ""),
  )
  .pipe(z.array(z.string().min(1).max(200)).max(20));
function createResolver(onSourceError: () => void) {
  return defineConfig({
    definition: {
      claudeModel: {
        schema: z.string().min(1).max(200),
        sources: ["flag", "default"],
        default: "claude-opus-5",
        names: { flag: "temporal-agent-chat-imessage-claude-model" },
      },
      codexModel: {
        schema: z.string().min(1).max(200),
        sources: ["flag", "default"],
        default: "gpt-5.6-luna",
        names: { flag: "temporal-agent-chat-imessage-codex-model" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "temporal-agent-chat-imessage",
        kinds: {
          claudeModel: "string",
          codexModel: "string",
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
