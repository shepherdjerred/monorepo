import lanePriorsData from "./lane-priors.generated.json" with { type: "json" };
import { inferStandardLanes } from "#src/lane-priors/inference.ts";
import {
  LanePriorArtifactSchema,
  type LaneInferenceParticipant,
  type LaneInferenceResult,
  type LanePriorArtifact,
} from "#src/lane-priors/schema.ts";

const rawLanePriors: unknown = lanePriorsData;

export const currentLanePriors: LanePriorArtifact =
  LanePriorArtifactSchema.parse(rawLanePriors);

export function inferStandardLanesWithCurrentPriors(
  participants: readonly LaneInferenceParticipant[],
): LaneInferenceResult {
  return inferStandardLanes(participants, currentLanePriors);
}
