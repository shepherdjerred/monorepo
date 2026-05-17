import { LANE_ORDER, type Lane } from "#src/model/lane.ts";
import {
  LaneInferenceParticipantSchema,
  LaneInferenceResultSchema,
  LanePriorArtifactSchema,
  SpellPairKeySchema,
  type LaneAssignment,
  type LaneInferenceParticipant,
  type LaneInferenceResult,
  type LanePriorArtifact,
  type LanePriorEntry,
  type LaneProbabilities,
  type SpellPairKey,
} from "#src/lane-priors/schema.ts";

const SMITE_SPELL_ID = 11;
const SMITE_JUNGLE_SCORE_BONUS = 3;
const PAYLOAD_ORDER_LANE_SCORE_BONUS = 1;
const LANE_BASELINE_PROBABILITY = 1 / LANE_ORDER.length;
const PRIOR_SMOOTHING = 0.01;

export function normalizeSpellPair(
  spell1Id: number,
  spell2Id: number,
): SpellPairKey {
  const ids =
    spell1Id <= spell2Id ? [spell1Id, spell2Id] : [spell2Id, spell1Id];
  const first = ids[0];
  const second = ids[1];
  if (first === undefined || second === undefined) {
    throw new Error("Expected exactly two summoner spell IDs");
  }
  return SpellPairKeySchema.parse(`${first.toString()}:${second.toString()}`);
}

function validateParticipants(
  participants: readonly LaneInferenceParticipant[],
): LaneInferenceParticipant[] {
  if (participants.length !== 5) {
    throw new Error(
      `Standard lane inference requires exactly 5 participants; received ${participants.length.toString()}`,
    );
  }
  return participants.map((participant) =>
    LaneInferenceParticipantSchema.parse(participant),
  );
}

function buildChampionPriorMap(
  artifact: LanePriorArtifact,
): Map<number, LanePriorEntry> {
  const map = new Map<number, LanePriorEntry>();
  for (const prior of artifact.champions) {
    if (map.has(prior.championId)) {
      throw new Error(
        `Duplicate champion lane prior for champion ${prior.championId.toString()}`,
      );
    }
    map.set(prior.championId, prior);
  }
  return map;
}

function buildSpellPriorMap(
  artifact: LanePriorArtifact,
): Map<SpellPairKey, LanePriorEntry> {
  const map = new Map<SpellPairKey, LanePriorEntry>();
  for (const prior of artifact.spellPairs) {
    if (map.has(prior.spellPair)) {
      throw new Error(`Duplicate spell-pair lane prior for ${prior.spellPair}`);
    }
    map.set(prior.spellPair, prior);
  }
  return map;
}

function probabilityScore(
  probabilities: LaneProbabilities | undefined,
  lane: Lane,
): number {
  const probability = probabilities?.[lane];
  if (probability === undefined) {
    return 0;
  }
  return Math.log(
    (probability + PRIOR_SMOOTHING) /
      (LANE_BASELINE_PROBABILITY + PRIOR_SMOOTHING),
  );
}

function scoreAssignment(
  participant: LaneInferenceParticipant,
  lane: Lane,
  participantIndex: number,
  priors: {
    championPriors: Map<number, LanePriorEntry>;
    spellPriors: Map<SpellPairKey, LanePriorEntry>;
  },
): number {
  const championPrior = priors.championPriors.get(participant.championId);
  const spellPrior = priors.spellPriors.get(
    normalizeSpellPair(participant.spell1Id, participant.spell2Id),
  );
  const smiteBonus =
    lane === "jungle" &&
    (participant.spell1Id === SMITE_SPELL_ID ||
      participant.spell2Id === SMITE_SPELL_ID)
      ? SMITE_JUNGLE_SCORE_BONUS
      : 0;
  const orderLane = LANE_ORDER[participantIndex];
  if (orderLane === undefined) {
    throw new Error(
      `Missing lane order entry for participant index ${participantIndex.toString()}`,
    );
  }
  const payloadOrderBonus =
    lane === orderLane ? PAYLOAD_ORDER_LANE_SCORE_BONUS : 0;

  return (
    probabilityScore(championPrior?.probabilities, lane) +
    probabilityScore(spellPrior?.probabilities, lane) +
    smiteBonus +
    payloadOrderBonus
  );
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) {
    return [[]];
  }

  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) {
      throw new Error(`Missing permutation item at index ${i.toString()}`);
    }
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) {
      result.push([item, ...tail]);
    }
  }
  return result;
}

function scorePermutation(
  participants: readonly LaneInferenceParticipant[],
  lanes: readonly Lane[],
  championPriors: Map<number, LanePriorEntry>,
  spellPriors: Map<SpellPairKey, LanePriorEntry>,
): { assignments: LaneAssignment[]; score: number } {
  const assignments: LaneAssignment[] = [];
  let score = 0;

  for (const [i, participant] of participants.entries()) {
    const lane = lanes[i];
    if (lane === undefined) {
      throw new Error("Lane assignment permutation length mismatch");
    }
    const assignmentScore = scoreAssignment(participant, lane, i, {
      championPriors,
      spellPriors,
    });
    assignments.push({
      participantKey: participant.participantKey,
      lane,
      score: assignmentScore,
    });
    score += assignmentScore;
  }

  return { assignments, score };
}

export function inferStandardLanes(
  rawParticipants: readonly LaneInferenceParticipant[],
  rawArtifact: LanePriorArtifact,
): LaneInferenceResult {
  const artifact = LanePriorArtifactSchema.parse(rawArtifact);
  const participants = validateParticipants(rawParticipants);
  const championPriors = buildChampionPriorMap(artifact);
  const spellPriors = buildSpellPriorMap(artifact);

  let best: { assignments: LaneAssignment[]; score: number } | undefined;
  let secondBest: { assignments: LaneAssignment[]; score: number } | undefined;

  for (const lanes of permutations(LANE_ORDER)) {
    const candidate = scorePermutation(
      participants,
      lanes,
      championPriors,
      spellPriors,
    );
    if (best === undefined || candidate.score > best.score) {
      secondBest = best;
      best = candidate;
      continue;
    }
    if (
      secondBest === undefined ||
      (candidate.score > secondBest.score && candidate.score < best.score)
    ) {
      secondBest = candidate;
    }
  }

  if (best === undefined) {
    throw new Error("Lane inference produced no assignments");
  }

  return LaneInferenceResultSchema.parse({
    assignments: best.assignments,
    bestScore: best.score,
    secondBestScore: secondBest?.score ?? null,
  });
}
