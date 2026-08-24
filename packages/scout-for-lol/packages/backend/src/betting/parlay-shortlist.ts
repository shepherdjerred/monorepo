import { z } from "zod";
import {
  ChampionTagSchema,
  LaneSchema,
  type ChampionTag,
  type Lane,
} from "@scout-for-lol/data";
import {
  MatchNumericFieldSchema,
  OpponentPingFieldSchema,
  TeamBooleanFieldSchema,
  TeamObjectiveSchema,
  type OpponentPingField,
} from "#src/betting/parlay-catalog.ts";

export const PARLAY_SHORTLIST_VERSION = "1";
const PLAYER_TARGET_COUNT = 16;
const GLOBAL_TARGET_COUNT = 4;

export const ShortlistParticipantFieldSchema = z.enum([
  "assists",
  "champExperience",
  "champLevel",
  "damageDealtToObjectives",
  "damageDealtToTurrets",
  "damageSelfMitigated",
  "deaths",
  "detectorWardsPlaced",
  "goldEarned",
  "goldSpent",
  "kills",
  "longestTimeSpentLiving",
  "magicDamageDealtToChampions",
  "neutralMinionsKilled",
  "physicalDamageDealtToChampions",
  "timeCCingOthers",
  "totalDamageDealt",
  "totalDamageDealtToChampions",
  "totalDamageTaken",
  "totalHeal",
  "totalHealsOnTeammates",
  "totalMinionsKilled",
  "totalTimeSpentDead",
  "visionScore",
  "visionWardsBoughtInGame",
  "wardsKilled",
  "wardsPlaced",
]);
export type ShortlistParticipantField = z.infer<
  typeof ShortlistParticipantFieldSchema
>;

const PlayerCandidateTargetSchema = z.strictObject({
  kind: z.literal("participant_numeric"),
  subject: z.string().regex(/^P[1-5]$/),
  participantNumericField: ShortlistParticipantFieldSchema,
});

const TeamBooleanCandidateTargetSchema = z.strictObject({
  kind: z.literal("team_boolean"),
  team: z.literal("selected"),
  teamBooleanField: TeamBooleanFieldSchema,
});

const TeamObjectiveCandidateTargetSchema = z.strictObject({
  kind: z.literal("team_objective_kills"),
  team: z.literal("selected"),
  objective: TeamObjectiveSchema.exclude(["riftHerald"]),
});

const MatchCandidateTargetSchema = z.strictObject({
  kind: z.literal("match_numeric"),
  matchNumericField: MatchNumericFieldSchema,
});

const PingCandidateTargetSchema = z.strictObject({
  kind: z.literal("opponent_team_pings"),
  opponentPingField: OpponentPingFieldSchema,
});

export const ParlayCandidateTargetSchema = z.discriminatedUnion("kind", [
  PlayerCandidateTargetSchema,
  TeamBooleanCandidateTargetSchema,
  TeamObjectiveCandidateTargetSchema,
  MatchCandidateTargetSchema,
  PingCandidateTargetSchema,
]);
export type ParlayCandidateTarget = z.infer<typeof ParlayCandidateTargetSchema>;

export const ParlayShortlistSchema = z
  .strictObject({
    version: z.literal(PARLAY_SHORTLIST_VERSION),
    candidates: z.array(ParlayCandidateTargetSchema).length(20),
  })
  .superRefine((shortlist, context) => {
    const playerCount = shortlist.candidates.filter(
      (candidate) => candidate.kind === "participant_numeric",
    ).length;
    if (playerCount !== PLAYER_TARGET_COUNT) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: `Shortlist must contain ${PLAYER_TARGET_COUNT.toString()} player targets`,
      });
    }
    if (shortlist.candidates.length - playerCount !== GLOBAL_TARGET_COUNT) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: `Shortlist must contain ${GLOBAL_TARGET_COUNT.toString()} global targets`,
      });
    }
    const keys = shortlist.candidates.map((candidate) =>
      candidateTargetKey(candidate),
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Shortlist targets must be unique",
      });
    }
    const pingCount = shortlist.candidates.filter(
      (candidate) => candidate.kind === "opponent_team_pings",
    ).length;
    if (pingCount > 1) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Shortlist may contain at most one opponent-ping target",
      });
    }
  });
export type ParlayShortlist = z.infer<typeof ParlayShortlistSchema>;

export const ParlayShortlistSubjectSchema = z.strictObject({
  key: z.string().regex(/^P[1-5]$/),
  lane: LaneSchema,
  tags: z.array(ChampionTagSchema).min(1),
});
export type ParlayShortlistSubject = z.infer<
  typeof ParlayShortlistSubjectSchema
>;

const UNIVERSAL_FIELDS: readonly ShortlistParticipantField[] = [
  "assists",
  "deaths",
  "kills",
  "goldEarned",
  "goldSpent",
  "longestTimeSpentLiving",
  "totalDamageDealtToChampions",
  "totalDamageTaken",
  "totalTimeSpentDead",
  "visionScore",
  "wardsPlaced",
];

const LANE_FIELDS: Record<Lane, readonly ShortlistParticipantField[]> = {
  top: [
    "champExperience",
    "champLevel",
    "damageDealtToTurrets",
    "damageSelfMitigated",
    "totalDamageDealt",
    "totalHeal",
    "totalMinionsKilled",
  ],
  jungle: [
    "damageDealtToObjectives",
    "detectorWardsPlaced",
    "neutralMinionsKilled",
    "timeCCingOthers",
    "totalDamageDealt",
    "totalHeal",
    "wardsKilled",
  ],
  middle: [
    "champExperience",
    "champLevel",
    "damageDealtToTurrets",
    "timeCCingOthers",
    "totalDamageDealt",
    "totalMinionsKilled",
  ],
  adc: [
    "champExperience",
    "champLevel",
    "damageDealtToTurrets",
    "totalDamageDealt",
    "totalMinionsKilled",
  ],
  support: [
    "detectorWardsPlaced",
    "timeCCingOthers",
    "totalHeal",
    "totalHealsOnTeammates",
    "visionWardsBoughtInGame",
    "wardsKilled",
  ],
};

const TAG_FIELDS: Record<ChampionTag, readonly ShortlistParticipantField[]> = {
  Assassin: ["damageDealtToTurrets", "totalDamageDealt", "totalMinionsKilled"],
  Fighter: [
    "damageDealtToObjectives",
    "damageDealtToTurrets",
    "damageSelfMitigated",
    "physicalDamageDealtToChampions",
    "totalDamageDealt",
    "totalHeal",
    "totalMinionsKilled",
  ],
  Mage: ["magicDamageDealtToChampions", "timeCCingOthers", "totalDamageDealt"],
  Marksman: [
    "damageDealtToTurrets",
    "physicalDamageDealtToChampions",
    "totalDamageDealt",
    "totalMinionsKilled",
  ],
  Support: [
    "detectorWardsPlaced",
    "timeCCingOthers",
    "totalHeal",
    "totalHealsOnTeammates",
    "visionWardsBoughtInGame",
    "wardsKilled",
  ],
  Tank: ["damageSelfMitigated", "timeCCingOthers", "totalHeal"],
};

const GLOBAL_TARGETS: readonly ParlayCandidateTarget[] = [
  { kind: "team_boolean", team: "selected", teamBooleanField: "win" },
  { kind: "team_objective_kills", team: "selected", objective: "baron" },
  {
    kind: "team_objective_kills",
    team: "selected",
    objective: "champion",
  },
  { kind: "team_objective_kills", team: "selected", objective: "dragon" },
  {
    kind: "team_objective_kills",
    team: "selected",
    objective: "inhibitor",
  },
  { kind: "team_objective_kills", team: "selected", objective: "tower" },
  { kind: "match_numeric", matchNumericField: "gameDuration" },
];

function hash(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

function seedForMatch(matchId: string): string {
  return `scout-parlay-shortlist:${PARLAY_SHORTLIST_VERSION}:${matchId}`;
}

function ranked<T>(
  values: readonly T[],
  seed: string,
  scope: string,
  key: (value: T) => string,
): T[] {
  return [...values]
    .toSorted((left, right) => key(left).localeCompare(key(right)))
    .map((value) => ({
      value,
      key: key(value),
      rank: hash(`${seed}\0${scope}\0${key(value)}`),
    }))
    .toSorted(
      (left, right) =>
        left.rank.localeCompare(right.rank) ||
        left.key.localeCompare(right.key),
    )
    .map(({ value }) => value);
}

export function candidateTargetKey(candidate: ParlayCandidateTarget): string {
  switch (candidate.kind) {
    case "participant_numeric":
      return `${candidate.subject}:${candidate.participantNumericField}`;
    case "team_boolean":
      return `team:${candidate.teamBooleanField}`;
    case "team_objective_kills":
      return `team:${candidate.objective}:kills`;
    case "match_numeric":
      return `match:${candidate.matchNumericField}`;
    case "opponent_team_pings":
      return `opponent:${candidate.opponentPingField}`;
  }
}

export function eligibleParticipantFields(input: {
  lane: Lane;
  tags: readonly ChampionTag[];
}): ShortlistParticipantField[] {
  return [
    ...new Set([
      ...UNIVERSAL_FIELDS,
      ...LANE_FIELDS[input.lane],
      ...input.tags.flatMap((tag) => TAG_FIELDS[tag]),
    ]),
  ].toSorted();
}

/** Exactly one SHA-256 bucket admits a ping target. */
export function parlayPingBucket(matchId: string): number {
  return Number.parseInt(
    hash(`${seedForMatch(matchId)}\0ping-gate`)[0] ?? "",
    16,
  );
}

function selectedPingTarget(
  matchId: string,
  seed: string,
): ParlayCandidateTarget | undefined {
  if (parlayPingBucket(matchId) !== 0) return;
  const field = ranked(
    OpponentPingFieldSchema.options,
    seed,
    "ping-type",
    (value: OpponentPingField) => value,
  )[0];
  if (field === undefined) {
    throw new Error("Opponent ping catalog is empty");
  }
  return { kind: "opponent_team_pings", opponentPingField: field };
}

export function buildParlayShortlist(input: {
  matchId: string;
  subjects: readonly ParlayShortlistSubject[];
}): ParlayShortlist {
  const subjects = z
    .array(ParlayShortlistSubjectSchema)
    .min(1)
    .max(5)
    .parse(input.subjects)
    .toSorted((left, right) => left.key.localeCompare(right.key));
  if (
    new Set(subjects.map((subject) => subject.key)).size !== subjects.length
  ) {
    throw new Error("Parlay shortlist subjects must be unique");
  }

  const seed = seedForMatch(input.matchId);
  const baseAllocation = Math.floor(PLAYER_TARGET_COUNT / subjects.length);
  const remainder = PLAYER_TARGET_COUNT % subjects.length;
  const extraSubjects = new Set(
    ranked(subjects, seed, "subject-allocation", (subject) => subject.key)
      .slice(0, remainder)
      .map((subject) => subject.key),
  );
  const selectedPlayerCandidates = subjects.flatMap((subject) => {
    const count = baseAllocation + (extraSubjects.has(subject.key) ? 1 : 0);
    const eligible = eligibleParticipantFields(subject);
    if (eligible.length < count) {
      throw new Error(
        `${subject.key} has ${eligible.length.toString()} eligible fields but needs ${count.toString()}`,
      );
    }
    return ranked(eligible, seed, `player:${subject.key}`, (field) => field)
      .slice(0, count)
      .map((field) => ({
        kind: "participant_numeric" as const,
        subject: subject.key,
        participantNumericField: field,
      }));
  });
  const playerCandidates = ranked(
    selectedPlayerCandidates,
    seed,
    "player-order",
    candidateTargetKey,
  );

  const ping = selectedPingTarget(input.matchId, seed);
  const selectedGlobals = ranked(
    GLOBAL_TARGETS,
    seed,
    "global",
    candidateTargetKey,
  ).slice(
    0,
    ping === undefined ? GLOBAL_TARGET_COUNT : GLOBAL_TARGET_COUNT - 1,
  );
  const globals = ranked(
    [...selectedGlobals, ...(ping === undefined ? [] : [ping])],
    seed,
    "global-order",
    candidateTargetKey,
  );

  return ParlayShortlistSchema.parse({
    version: PARLAY_SHORTLIST_VERSION,
    candidates: [...playerCandidates, ...globals],
  });
}
