import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod/v4";
import { ImessageOwnersSchema } from "./imessage.ts";

export async function photonIngressConfig() {
  let sourceAvailable = true;
  const unavailable = () => {
    sourceAvailable = false;
  };
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "temporal-agent-chat-photon-enabled" },
      },
      owners: {
        schema: ImessageOwnersSchema,
        sources: ["flag", "default"],
        default: "[]",
        names: { flag: "temporal-agent-chat-photon-owners" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "temporal-agent-chat-photon",
        kinds: { enabled: "boolean", owners: "string" },
        onUnavailable: unavailable,
      }),
    },
    hooks: {
      onSourceError: (key, source) => {
        unavailable();
        console.warn(
          JSON.stringify({
            component: "config.photon",
            msg: "Photon configuration source failed",
            key,
            source,
          }),
        );
      },
    },
  });
  const [enabled, owners] = await Promise.all([
    resolver.value("enabled"),
    resolver.value("owners"),
  ]);
  return { sourceAvailable, enabled, owners };
}
