import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";
import {
  CodeReviewSettingsSchema,
  DEFAULT_CODE_REVIEW_SETTINGS_JSON,
  type CodeReviewSettings,
} from "#shared/ci/code-review.ts";

const CodeReviewSettingsJsonSchema = z
  .string()
  .transform((value, context) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      context.addIssue({
        code: "custom",
        message: "Expected valid JSON for temporal-code-review-settings",
      });
      return z.NEVER;
    }
  })
  .pipe(CodeReviewSettingsSchema);

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
        schema: CodeReviewSettingsJsonSchema,
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
          settings: "string",
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
