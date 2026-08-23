import {
  type ClassicLoadingScreenParticipant,
  LoadingScreenChampionIdSchema,
  SummonerSpellIdSchema,
  inferStandardLanesWithCurrentPriors,
  getModernChampionIdForClassic,
  getModernSpellIdForClassic,
} from "@scout-for-lol/data/index.ts";

const CLASSIC_LANE_ORDER = [
  "top",
  "jungle",
  "middle",
  "adc",
  "support",
] as const;

function laneInferenceKey(index: number): string {
  return `participant:${index.toString()}`;
}

function orderFullClassicTeam(
  participants: ClassicLoadingScreenParticipant[],
): ClassicLoadingScreenParticipant[] {
  const inference = inferStandardLanesWithCurrentPriors(
    participants.map((participant, index) => ({
      participantKey: laneInferenceKey(index),
      championId: LoadingScreenChampionIdSchema.parse(
        getModernChampionIdForClassic(participant.championId),
      ),
      spell1Id: SummonerSpellIdSchema.parse(
        getModernSpellIdForClassic(participant.spell1Id) ??
          participant.spell1Id,
      ),
      spell2Id: SummonerSpellIdSchema.parse(
        getModernSpellIdForClassic(participant.spell2Id) ??
          participant.spell2Id,
      ),
    })),
  );
  const laneByIndex = new Map(
    inference.assignments.map((assignment) => [
      Number(assignment.participantKey.replace("participant:", "")),
      assignment.lane,
    ]),
  );
  return participants
    .map((participant, index) => ({
      participant,
      lane: laneByIndex.get(index),
    }))
    .toSorted(
      (left, right) =>
        CLASSIC_LANE_ORDER.indexOf(left.lane ?? "support") -
        CLASSIC_LANE_ORDER.indexOf(right.lane ?? "support"),
    )
    .map((entry) => entry.participant);
}

export function orderClassicParticipants(
  participants: ClassicLoadingScreenParticipant[],
): ClassicLoadingScreenParticipant[] {
  const blue = participants.filter(
    (participant) => participant.team === "blue",
  );
  const red = participants.filter((participant) => participant.team === "red");
  if (blue.length !== 5 || red.length !== 5) {
    return participants;
  }
  return [...orderFullClassicTeam(blue), ...orderFullClassicTeam(red)];
}
