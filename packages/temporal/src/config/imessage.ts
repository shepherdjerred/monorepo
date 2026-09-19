import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod/v4";

export const ImessageOwnersSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  )
  .pipe(z.array(z.string().min(1).max(200)).max(20));
const resolver = defineConfig({
  definition: {
    enabled: {
      schema: z.boolean(),
      sources: ["flag", "default"],
      default: false,
      names: { flag: "temporal-agent-chat-imessage-enabled" },
    },
    owners: {
      schema: ImessageOwnersSchema,
      sources: ["flag", "default"],
      default: "",
      names: { flag: "temporal-agent-chat-imessage-owners" },
    },
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
        enabled: "boolean",
        owners: "string",
        claudeModel: "string",
        codexModel: "string",
      },
    }),
  },
  hooks: {
    onSourceError: (key, source) => {
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
export async function imessageIngressConfig() {
  return {
    enabled: await resolver.value("enabled"),
    owners: await resolver.value("owners"),
    claudeModel: await resolver.value("claudeModel"),
    codexModel: await resolver.value("codexModel"),
  };
}
