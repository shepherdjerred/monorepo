import {
  CHALLENGE_CONTRACT_VERSION,
  CHALLENGE_EVALUATOR_VERSION,
  ChallengeContractV1Schema,
} from "#src/model/progression/challenge.ts";

export const WIN_EVERY_CURRENT_CHAMPION_TEMPLATE =
  ChallengeContractV1Schema.parse({
    version: CHALLENGE_CONTRACT_VERSION,
    evaluatorVersion: CHALLENGE_EVALUATOR_VERSION,
    title: "Win on every current champion A–Z",
    summary:
      "Win at least once on every champion available when this run starts.",
    explanation: [
      "Only completed wins count.",
      "The champion list is frozen when the run begins, so new releases do not move the finish line.",
    ],
    matchPredicate: { kind: "result", result: "win" },
    progressGoal: {
      kind: "distinct",
      dimension: "champions",
      explicitField: null,
      target: 1,
      catalog: "current_champions",
      requiredValues: [],
    },
  });
