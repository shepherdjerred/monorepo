import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod/v4";

/** Email routing is resolved per delivery activity; credentials remain in env. */
export async function postalAddressesConfig() {
  const resolver = defineConfig({
    definition: {
      recipient: {
        schema: z.email(),
        sources: ["flag", "default"],
        default: "dependencies@sjer.red",
        names: { flag: "temporal-email-recipient" },
      },
      sender: {
        schema: z.email(),
        sources: ["flag", "default"],
        default: "deps@sjer.red",
        names: { flag: "temporal-email-sender" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "temporal-reports-worker",
        kinds: { recipient: "string", sender: "string" },
      }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(`[Config] ${key} ${source}: ${message}`);
      },
    },
  });
  const [recipient, sender] = await Promise.all([
    resolver.value("recipient"),
    resolver.value("sender"),
  ]);
  return { recipient, sender };
}
