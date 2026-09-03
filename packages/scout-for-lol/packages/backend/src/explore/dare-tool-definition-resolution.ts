import type { z } from "zod";
import type { DareTargetBindingV2 } from "@scout-for-lol/data";
import type { DareDraftV2Definition } from "#src/betting/dare-draft-v2.ts";
import type { DareDraftV3Definition } from "#src/betting/dare-draft-v3.ts";
import type {
  DareDefinitionV2ToolInputSchema,
  DareDefinitionV3ToolInputSchema,
} from "#src/explore/dare-tool-schemas.ts";

function resolveTargets(
  requestedKeys: readonly string[],
  targets: readonly DareTargetBindingV2[],
): DareTargetBindingV2[] {
  if (new Set(requestedKeys).size !== requestedKeys.length) {
    throw new Error("A dare target key may appear only once.");
  }
  return requestedKeys.map((key) => {
    const target = targets.find((candidate) => candidate.key === key);
    if (target === undefined) {
      throw new Error(`Dare target ${key} is not in the current shortlist.`);
    }
    return target;
  });
}

export function definitionFromTool(
  input: z.infer<typeof DareDefinitionV2ToolInputSchema>,
  targets: readonly DareTargetBindingV2[],
): DareDraftV2Definition {
  return {
    originalText: input.originalText,
    targets: resolveTargets(input.targetKeys, targets),
    plan: input.plan,
    deadlineSpec: input.deadlineSpec,
    openingStake: input.openingStake,
  };
}

export function definitionV3FromTool(
  input: z.infer<typeof DareDefinitionV3ToolInputSchema>,
  targets: readonly DareTargetBindingV2[],
): DareDraftV3Definition {
  return {
    originalText: input.originalText,
    queryText: input.queryText,
    plainLanguage: input.plainLanguage,
    targets: resolveTargets(input.targetKeys, targets),
    deadlineSpec: input.deadlineSpec,
    openingStake: input.openingStake,
  };
}
