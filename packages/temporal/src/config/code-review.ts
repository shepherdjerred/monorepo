import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { z } from "zod";
import {
  DEFAULT_CODE_REVIEW_SETTINGS_JSON,
  ProviderWeightsSchema,
  type CodeReviewSettings,
} from "#shared/ci/code-review.ts";

/**
 * The registry validates the stored settings; `ProviderWeightsSchema` then
 * drops absent providers so `weights` is a `ProviderWeights`.
 */
const CodeReviewSettingsFlagSchema = flagValueSchema(
  "temporal-code-review-settings",
).transform((settings): CodeReviewSettings => ({
  ...settings,
  weights: ProviderWeightsSchema.parse(settings.weights),
}));

export type CodeReviewRuntimeConfig = {
  enabled: boolean;
  settings: CodeReviewSettings;
};

/**
 * Re-evaluated per PR code-review workflow run so weight adjustments, provider
 * disables, and emergency kill-switches take effect without redeploying workers.
 */
export async function codeReviewConfig(): Promise<CodeReviewRuntimeConfig> {
  const resolver = defineConfig({
    definition: {
      enabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: true,
        names: { flag: "temporal-code-review-enabled" },
      },
      settings: {
        schema: CodeReviewSettingsFlagSchema,
        sources: ["flag", "default"],
        default: DEFAULT_CODE_REVIEW_SETTINGS_JSON,
        names: { flag: "temporal-code-review-settings" },
      },
    } as const,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "temporal-code-review-worker",
        kinds: {
          enabled: "boolean",
          settings: flagValueKind("temporal-code-review-settings"),
        },
      }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(
          JSON.stringify({
            level: "warning",
            msg: "Code review dynamic config source failed; falling back to default",
            component: "config.code-review",
            key,
            source,
            error: message,
          }),
        );
      },
    },
  });

  const [enabled, settings] = await Promise.all([
    resolver.value("enabled"),
    resolver.value("settings"),
  ]);

  return { enabled, settings };
}
