import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod/v4";

export function promotionFlagSource(targetingKey: string) {
  let available = true;
  const onUnavailable = () => {
    available = false;
  };
  return {
    sources: {
      flag: createFlagConfigSource({
        targetingKey,
        attributes: { environment: "prod" },
        kinds: { enabled: "boolean", settings: "string" },
        requireFreshSnapshot: true,
        onUnavailable,
      }),
    },
    hooks: { onSourceError: onUnavailable },
    get available() {
      return available;
    },
  };
}

export async function promotionConfig() {
  const flags = promotionFlagSource("the-storm-promotion-prod");
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "the-storm-promotion-enabled" },
      },
      settings: {
        schema: z
          .string()
          .transform((value, context) => {
            try {
              const parsed: unknown = JSON.parse(value);
              return parsed;
            } catch {
              context.addIssue({
                code: "custom",
                message: "Expected promotion settings JSON",
              });
              return z.NEVER;
            }
          })
          .pipe(
            z.strictObject({
              model: z.string().min(1),
              maxSteps: z.number().int().min(1).max(80),
              timeoutMinutes: z.number().int().min(1).max(15),
              monthlySolverUsd: z.number().min(0).max(10),
              enabledTargets: z.array(z.string()),
              dailySpendUsd: z.number().nonnegative().max(5).default(5),
            }),
          ),
        sources: ["flag", "default"],
        default: JSON.stringify({
          model: "gpt-6-luna",
          maxSteps: 80,
          timeoutMinutes: 15,
          monthlySolverUsd: 10,
          dailySpendUsd: 5,
          enabledTargets: [],
        }),
        names: { flag: "the-storm-promotion-settings" },
      },
    } as const,
    sources: flags.sources,
    hooks: flags.hooks,
  });
  const [enabled, settings] = await Promise.all([
    resolver.value("enabled"),
    resolver.value("settings"),
  ]);
  return {
    enabled: flags.available && enabled,
    ...settings,
    available: flags.available,
  };
}
