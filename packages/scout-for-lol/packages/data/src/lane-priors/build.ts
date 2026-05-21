import { LANE_ORDER, parseLane, type Lane } from "#src/model/lane.ts";
import type { RawMatch } from "#src/league/raw-match.schema.ts";
import {
  LanePriorArtifactSchema,
  type LaneCounts,
  type LanePriorArtifact,
  type LanePriorSource,
  type SpellPairKey,
} from "#src/lane-priors/schema.ts";
import { normalizeSpellPair } from "#src/lane-priors/inference.ts";

function emptyCounts(): LaneCounts {
  return {
    top: 0,
    jungle: 0,
    middle: 0,
    adc: 0,
    support: 0,
  };
}

function incrementCount(counts: LaneCounts, lane: Lane): LaneCounts {
  return {
    ...counts,
    [lane]: counts[lane] + 1,
  };
}

function totalCounts(counts: LaneCounts): number {
  return LANE_ORDER.reduce((total, lane) => total + counts[lane], 0);
}

function probabilities(counts: LaneCounts): Record<Lane, number> {
  const total = totalCounts(counts);
  if (total === 0) {
    throw new Error("Cannot build probabilities from empty lane counts");
  }
  return {
    top: counts.top / total,
    jungle: counts.jungle / total,
    middle: counts.middle / total,
    adc: counts.adc / total,
    support: counts.support / total,
  };
}

function addChampionCount(
  countsByChampion: Map<number, LaneCounts>,
  championId: number,
  lane: Lane,
): void {
  const counts = countsByChampion.get(championId) ?? emptyCounts();
  countsByChampion.set(championId, incrementCount(counts, lane));
}

function addSpellPairCount(
  countsBySpellPair: Map<SpellPairKey, LaneCounts>,
  spellPair: SpellPairKey,
  lane: Lane,
): void {
  const counts = countsBySpellPair.get(spellPair) ?? emptyCounts();
  countsBySpellPair.set(spellPair, incrementCount(counts, lane));
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].toSorted((a, b) => a - b);
}

function sortedSpellPairs(values: Iterable<SpellPairKey>): SpellPairKey[] {
  return [...values].toSorted((a, b) => a.localeCompare(b));
}

function spellIdsFromPair(spellPair: SpellPairKey): [number, number] {
  const split = spellPair.split(":");
  const firstRaw = split[0];
  const secondRaw = split[1];
  if (firstRaw === undefined || secondRaw === undefined || split.length !== 2) {
    throw new Error(`Invalid spell pair key: ${spellPair}`);
  }
  const first = Number(firstRaw);
  const second = Number(secondRaw);
  if (!Number.isInteger(first) || !Number.isInteger(second)) {
    throw new TypeError(`Invalid spell pair key: ${spellPair}`);
  }
  return [first, second];
}

function standardParticipants(match: RawMatch): {
  championId: number;
  spell1Id: number;
  spell2Id: number;
  lane: Lane;
}[] {
  const result: {
    championId: number;
    spell1Id: number;
    spell2Id: number;
    lane: Lane;
  }[] = [];

  for (const teamId of [100, 200]) {
    const teamParticipants = match.info.participants.filter(
      (participant) => participant.teamId === teamId,
    );
    if (teamParticipants.length !== 5) {
      throw new Error(
        `Match ${match.metadata.matchId} team ${teamId.toString()} has ${teamParticipants.length.toString()} participants; expected 5`,
      );
    }
    for (const participant of teamParticipants) {
      const lane = parseLane(participant.teamPosition);
      if (lane === undefined) {
        throw new Error(
          `Match ${match.metadata.matchId} participant ${participant.participantId.toString()} is missing a standard teamPosition`,
        );
      }
      result.push({
        championId: participant.championId,
        spell1Id: participant.summoner1Id,
        spell2Id: participant.summoner2Id,
        lane,
      });
    }
  }

  return result;
}

export function buildLanePriorArtifact(input: {
  matches: readonly RawMatch[];
  queueIds: readonly number[];
  sourceStartDate: string;
  sourceEndDate: string;
  generatedAt: string;
}): LanePriorArtifact {
  const queueIdSet = new Set(input.queueIds);
  const countsByChampion = new Map<number, LaneCounts>();
  const countsBySpellPair = new Map<SpellPairKey, LaneCounts>();
  let matchCount = 0;
  let participantCount = 0;

  for (const match of input.matches) {
    if (!queueIdSet.has(match.info.queueId)) {
      continue;
    }
    matchCount += 1;
    for (const participant of standardParticipants(match)) {
      participantCount += 1;
      addChampionCount(
        countsByChampion,
        participant.championId,
        participant.lane,
      );
      addSpellPairCount(
        countsBySpellPair,
        normalizeSpellPair(participant.spell1Id, participant.spell2Id),
        participant.lane,
      );
    }
  }

  const source: LanePriorSource = {
    startDate: input.sourceStartDate,
    endDate: input.sourceEndDate,
    queueIds: [...input.queueIds],
    matchCount,
    participantCount,
  };

  return LanePriorArtifactSchema.parse({
    artifactVersion: 1,
    generatedAt: input.generatedAt,
    source,
    champions: sortedNumbers(countsByChampion.keys()).map((championId) => {
      const counts = countsByChampion.get(championId);
      if (counts === undefined) {
        throw new Error(
          `Missing champion counts for champion ${championId.toString()}`,
        );
      }
      return {
        championId,
        total: totalCounts(counts),
        counts,
        probabilities: probabilities(counts),
      };
    }),
    spellPairs: sortedSpellPairs(countsBySpellPair.keys()).map((spellPair) => {
      const counts = countsBySpellPair.get(spellPair);
      if (counts === undefined) {
        throw new Error(`Missing spell-pair counts for ${spellPair}`);
      }
      return {
        spellPair,
        spellIds: spellIdsFromPair(spellPair),
        total: totalCounts(counts),
        counts,
        probabilities: probabilities(counts),
      };
    }),
  });
}
