import { readdir, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import {
  extractTemplateVariables,
  replacePromptVariables,
} from "#src/review/pipeline/pipeline-utils.ts";
import { generateImage } from "#src/review/pipeline/pipeline-stages.ts";
import { getDefaultStageConfigs } from "#src/review/pipeline/pipeline-defaults.ts";
import type { ImageGenerationClient } from "#src/review/pipeline/pipeline-types.ts";
import {
  PROMPT_STAGE_NAMES,
  STAGE_PROMPT_VARIABLES,
  type PromptStageName,
} from "#src/review/prompt-variables.ts";

/**
 * Guards the prompt-hydration contract:
 *
 * 1. Every stage's default template variables must match the registry
 *    (STAGE_PROMPT_VARIABLES) exactly. Drift in either direction — a
 *    placeholder nobody fills, or a registry entry no template uses —
 *    fails here instead of silently degrading output. (reviewText's user
 *    template is exempt: legacy space-form placeholders outside the
 *    validator's syntax; see the test body.)
 * 2. All hydration must go through replacePromptVariables, which throws
 *    on missing/unused variables. No raw replaceAll on placeholders
 *    anywhere in the pipeline or art sources (the validator itself
 *    excluded). This is the rule the deleted image-prompt.ts broke:
 *    a dead <ART_STYLE> replace that could never fire.
 */
describe("prompt template variable conformance", () => {
  const stages = getDefaultStageConfigs();
  const prompts: Record<PromptStageName, { system?: string; user: string }> = {
    timelineSummary: {
      system: stages.timelineSummary.systemPrompt,
      user: stages.timelineSummary.userPrompt,
    },
    matchSummary: {
      system: stages.matchSummary.systemPrompt,
      user: stages.matchSummary.userPrompt,
    },
    reviewText: {
      system: stages.reviewText.systemPrompt,
      user: stages.reviewText.userPrompt,
    },
    imageDescription: {
      system: stages.imageDescription.systemPrompt,
      user: stages.imageDescription.userPrompt,
    },
    imageGeneration: {
      user: stages.imageGeneration.userPrompt,
    },
  };

  test.each(PROMPT_STAGE_NAMES)(
    "%s default templates match the registry",
    (stage) => {
      const variables = STAGE_PROMPT_VARIABLES[stage];
      const { system, user } = prompts[stage];

      const templateSystemVars = new Set<string>();
      if (system !== undefined) {
        for (const v of extractTemplateVariables(system)) {
          templateSystemVars.add(v);
        }
      }
      const registrySystemVars = new Set(variables.system.map((v) => v.name));
      expect([...templateSystemVars].sort()).toEqual(
        [...registrySystemVars].sort(),
      );

      // reviewText's user template uses legacy space-form placeholders
      // (<REVIEWER NAME>) hydrated by prompts.ts replaceTemplateVariables,
      // which is outside the validator's <VAR> syntax. Migrating that path
      // is a separate change; the system side is covered here.
      if (stage === "reviewText") return;
      const templateUserVars = extractTemplateVariables(user);
      const registryUserVars = new Set(variables.user.map((v) => v.name));
      expect([...templateUserVars].sort()).toEqual(
        [...registryUserVars].sort(),
      );
    },
  );

  test("replacePromptVariables throws on an unused replacement", () => {
    expect(() =>
      replacePromptVariables("hello <A>", { A: "x", B: "y" }),
    ).toThrow(/Unused prompt variables: B/);
  });

  test("replacePromptVariables throws on an unhydrated placeholder", () => {
    expect(() =>
      replacePromptVariables("hello <A> and <B>", { A: "x" }),
    ).toThrow(/Missing prompt variables: B/);
  });

  test("stage 4 tolerates custom templates without ART_STYLE", async () => {
    // Pre-change custom templates only contain <IMAGE_DESCRIPTION>.
    // Passing ART_STYLE unconditionally would make the validator reject
    // the extra variable and silently disable image generation.
    const seen: string[] = [];
    const client: ImageGenerationClient = {
      generate: (params) => {
        seen.push(params.prompt);
        return Promise.resolve({ imageBase64: "aW1hZ2U=" });
      },
    };
    const base = {
      imageDescription: "a knight beholding a throw",
      artStyle: "oil painting",
      client,
      model: "gemini-2.5-flash-image",
      timeoutMs: 60_000,
    };
    const legacy = await generateImage({
      ...base,
      userPrompt: "Paint this: <IMAGE_DESCRIPTION>",
    });
    expect(legacy.imageBase64).toBe("aW1hZ2U=");

    const current = await generateImage({
      ...base,
      userPrompt: "Paint this: <IMAGE_DESCRIPTION> in <ART_STYLE>",
    });
    expect(current.trace.model).toBe("gemini-2.5-flash-image");
    expect(seen).toEqual([
      "Paint this: a knight beholding a throw",
      "Paint this: a knight beholding a throw in oil painting",
    ]);
  });

  test("no raw placeholder replacement outside the validator", async () => {
    const here = import.meta.dirname;
    const dirs = [here, `${here}/../art`];
    const rawPlaceholderReplace = /\.replaceAll\(\s*[`'"]</;
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of await readdir(dir)) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        if (file === "pipeline-utils.ts") continue;
        const content = await readFile(`${dir}/${file}`, "utf8");
        if (rawPlaceholderReplace.test(content)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
