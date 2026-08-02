import {
  getStyleCard,
  PersonalityMetadataSchema,
  type Lane,
  type Personality,
} from "@scout-for-lol/data";
import aaronMetadata from "@scout-for-lol/data/review/prompts/personalities/aaron.json";
import aaronInstructions from "@scout-for-lol/data/review/prompts/personalities/aaron.txt";
import nekoRyanMetadata from "@scout-for-lol/data/review/prompts/personalities/nekoryan.json";
import nekoRyanInstructions from "@scout-for-lol/data/review/prompts/personalities/nekoryan.txt";
import adcLane from "@scout-for-lol/data/review/prompts/lanes/adc.txt";
import genericLane from "@scout-for-lol/data/review/prompts/lanes/generic.txt";
import jungleLane from "@scout-for-lol/data/review/prompts/lanes/jungle.txt";
import middleLane from "@scout-for-lol/data/review/prompts/lanes/middle.txt";
import supportLane from "@scout-for-lol/data/review/prompts/lanes/support.txt";
import topLane from "@scout-for-lol/data/review/prompts/lanes/top.txt";

import type { MaterializationCaseSpec } from "#materialization/spec.ts";

const LANE_CONTEXT: Record<Lane, string> = {
  adc: adcLane,
  jungle: jungleLane,
  middle: middleLane,
  support: supportLane,
  top: topLane,
};

export function loadLaneContext(lane: Lane | undefined): string {
  return (lane === undefined ? genericLane : LANE_CONTEXT[lane]).trim();
}

export function loadFrozenPersonality(
  spec: MaterializationCaseSpec,
): Personality {
  const source =
    spec.styleKey === "aaron"
      ? { metadata: aaronMetadata, instructions: aaronInstructions }
      : { metadata: nekoRyanMetadata, instructions: nekoRyanInstructions };
  const metadata = PersonalityMetadataSchema.parse(source.metadata);
  const styleCard = getStyleCard(spec.styleKey);
  if (styleCard === undefined) {
    throw new Error(`Missing style card for ${spec.styleKey}`);
  }
  // Freezing behaviors replaces the personality's canonical randomBehaviors, so
  // every frozen behavior must be a unique prompt from THIS personality. A typo,
  // duplicate, or behavior copied from the other style would otherwise be scored
  // under the wrong treatment and silently contaminate calibration.
  const canonicalBehaviors = new Set(
    (metadata.randomBehaviors ?? []).map((behavior) => behavior.prompt),
  );
  const seenBehaviors = new Set<string>();
  for (const behavior of spec.selectedBehaviors) {
    if (!canonicalBehaviors.has(behavior)) {
      throw new Error(
        `Frozen behavior is not a ${spec.styleKey} personality behavior: ${behavior}`,
      );
    }
    if (seenBehaviors.has(behavior)) {
      throw new Error(
        `Frozen behavior is duplicated for ${spec.styleKey}: ${behavior}`,
      );
    }
    seenBehaviors.add(behavior);
  }
  return {
    filename: spec.styleKey,
    instructions: source.instructions.trim(),
    metadata: {
      ...metadata,
      randomBehaviors: [
        { prompt: spec.selectedBehaviors.join("\n"), weight: 100 },
      ],
    },
    styleCard: JSON.stringify(styleCard),
  };
}
