import {
  CHALLENGE_CONTRACT_VERSION,
  CHALLENGE_EVALUATOR_VERSION,
  ChallengeContractV1Schema,
} from "#src/model/progression/challenge.ts";

export const WIN_EVERY_CURRENT_CHAMPION_SOLO_TEMPLATE =
  ChallengeContractV1Schema.parse({
    version: CHALLENGE_CONTRACT_VERSION,
    evaluatorVersion: CHALLENGE_EVALUATOR_VERSION,
    title: "Win on every current champion A–Z (Ranked Solo/Duo)",
    summary:
      "Win at least once on every champion available in Ranked Solo/Duo.",
    explanation: [
      "Only completed Ranked Solo/Duo wins count.",
      "The champion list is frozen when the run begins, so new releases do not move the finish line.",
    ],
    matchPredicate: {
      kind: "all",
      predicates: [
        { kind: "result", result: "win" },
        { kind: "queue_in", queues: ["solo"] },
      ],
    },
    progressGoal: {
      kind: "distinct",
      dimension: "champions",
      explicitField: null,
      target: 1,
      catalog: "current_champions",
      requiredValues: [],
    },
  });

export const WIN_EVERY_CURRENT_CHAMPION_FLEX_TEMPLATE =
  ChallengeContractV1Schema.parse({
    version: CHALLENGE_CONTRACT_VERSION,
    evaluatorVersion: CHALLENGE_EVALUATOR_VERSION,
    title: "Win on every current champion A–Z (Ranked Flex)",
    summary: "Win at least once on every champion available in Ranked Flex.",
    explanation: [
      "Only completed Ranked Flex wins count.",
      "The champion list is frozen when the run begins, so new releases do not move the finish line.",
    ],
    matchPredicate: {
      kind: "all",
      predicates: [
        { kind: "result", result: "win" },
        { kind: "queue_in", queues: ["flex"] },
      ],
    },
    progressGoal: {
      kind: "distinct",
      dimension: "champions",
      explicitField: null,
      target: 1,
      catalog: "current_champions",
      requiredValues: [],
    },
  });

export const WIN_EVERY_CURRENT_CHAMPION_ARENA_WIN_TEMPLATE =
  ChallengeContractV1Schema.parse({
    version: CHALLENGE_CONTRACT_VERSION,
    evaluatorVersion: CHALLENGE_EVALUATOR_VERSION,
    title: "Win on every current champion A–Z (Arena - Top 3)",
    summary: "Place 3rd or higher on every champion available in Arena.",
    explanation: [
      "Placing 3rd or higher in Arena counts as a win.",
      "The champion list is frozen when the run begins, so new releases do not move the finish line.",
    ],
    matchPredicate: {
      kind: "all",
      predicates: [
        { kind: "queue_in", queues: ["arena"] },
        {
          kind: "numeric",
          field: "placement",
          operator: "lte",
          threshold: 3,
        },
      ],
    },
    progressGoal: {
      kind: "distinct",
      dimension: "champions",
      explicitField: null,
      target: 1,
      catalog: "current_champions",
      requiredValues: [],
    },
  });

export const WIN_EVERY_CURRENT_CHAMPION_ARENA_FIRST_TEMPLATE =
  ChallengeContractV1Schema.parse({
    version: CHALLENGE_CONTRACT_VERSION,
    evaluatorVersion: CHALLENGE_EVALUATOR_VERSION,
    title: "Win on every current champion A–Z (Arena - 1st Place)",
    summary: "Take 1st place on every champion available in Arena.",
    explanation: [
      "Only 1st place finishes in Arena count.",
      "The champion list is frozen when the run begins, so new releases do not move the finish line.",
    ],
    matchPredicate: {
      kind: "all",
      predicates: [
        { kind: "queue_in", queues: ["arena"] },
        {
          kind: "numeric",
          field: "placement",
          operator: "eq",
          threshold: 1,
        },
      ],
    },
    progressGoal: {
      kind: "distinct",
      dimension: "champions",
      explicitField: null,
      target: 1,
      catalog: "current_champions",
      requiredValues: [],
    },
  });
