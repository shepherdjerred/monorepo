import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { z } from "zod/v4";

type PromotionSettingsFlag =
  "the-storm-promotion-settings" | "the-storm-reddit-outreach-settings";

export function promotionFlagSource(
  targetingKey: string,
  settingsFlag: PromotionSettingsFlag,
) {
  let available = true;
  const onUnavailable = () => {
    available = false;
  };
  return {
    sources: {
      flag: createFlagConfigSource({
        targetingKey,
        attributes: { environment: "prod" },
        kinds: { enabled: "boolean", settings: flagValueKind(settingsFlag) },
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
  const flags = promotionFlagSource(
    "the-storm-promotion-prod",
    "the-storm-promotion-settings",
  );
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "the-storm-promotion-enabled" },
      },
      settings: {
        schema: flagValueSchema("the-storm-promotion-settings"),
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
