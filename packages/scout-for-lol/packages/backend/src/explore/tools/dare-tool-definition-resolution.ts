import type { DareDraftDefinition } from "#src/dares/lifecycle/dare-draft.ts";
import type { DareDefinitionToolInputSchema } from "#src/explore/tools/dare-tool-schemas.ts";
import type { DareTargetBinding } from "@scout-for-lol/data";
import type { z } from "zod";

function resolveTargets(
  requestedKeys: readonly string[],
  targets: readonly DareTargetBinding[],
): DareTargetBinding[] {
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
  input: z.infer<typeof DareDefinitionToolInputSchema>,
  targets: readonly DareTargetBinding[],
): DareDraftDefinition {
  return {
    originalText: input.originalText,
    displayTitle: input.displayTitle,
    statusPhrases: input.statusPhrases,
    queryText: input.queryText,
    plainLanguage: input.plainLanguage,
    targets: resolveTargets(input.targetKeys, targets),
    deadlineSpec: input.deadlineSpec,
    competition: input.competition,
    activation: input.activation,
  };
}
