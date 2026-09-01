import { z } from "zod";
import {
  championNameToDisplayName,
  formatParlayNumericValue,
  normalizeChampionName,
  type BucksDareHorizonKind,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import {
  compare,
  PARTICIPANT_BOOLEAN_CATALOG,
  PARTICIPANT_NUMERIC_CATALOG,
  ParticipantNumericFieldSchema,
  participantBooleanValue,
  participantNumericValue,
} from "#src/betting/parlay-catalog.ts";
import { countLabel } from "#src/betting/weekly-parlay-discord-copy.ts";

/**
 * The closed condition language for `/bb dare` bounties.
 *
 * A dare is a one-sided bet that the targets ACHIEVE something: contributors
 * fund a pot with no upside, and the structured tree below is the only thing
 * settlement ever evaluates. The LLM translation layer proposes values inside
 * these schemas and nothing else; free text and model prose never reach
 * settlement.
 *
 * Everything expressible here is a monotone achievement — "at least N
 * qualifying games where a per-game predicate held". Counts only grow, so a
 * true leaf can never become false, and all/any over monotone inputs is
 * monotone. Early settlement the moment the root evaluates true depends on
 * that property; a future leaf kind that is not monotone (a "maintain X every
 * game" claim) must bump `DARE_EVALUATOR_VERSION` and revisit early
 * settlement, never just extend an enum.
 */

export const DARE_CONDITION_VERSION = 1;

/**
 * Settlement gate, parlay-evaluator precedent: a stored dare whose recorded
 * version differs is voided and refunded. Bump only when the MEANING of an
 * existing condition changes — adding a condition kind leaves every stored
 * dare evaluating identically, and a bump would refund live pots to advertise
 * a change that cannot affect them.
 */
export const DARE_EVALUATOR_VERSION = "1";

/**
 * Deliberately its own list rather than `BUCKS_EARNING_QUEUES`: clash is an
 * earning queue but not a dare queue (weekly-parlay precedent — a dare about
 * ranked habit should not be achievable in a one-off clash bracket).
 */
export const DARE_ELIGIBLE_QUEUES = ["solo", "flex", "ranked 5s"] as const;

/** Rate thresholds are stored in hundredths ("7 CS per minute" -> 700), so
 * comparison stays integer-exact via cross-multiplication — no floats. */
export const DARE_RATE_SCALE = 100;

/**
 * Fields a target can farm at zero gameplay cost. The parlay catalog already
 * excludes pings for the same reason; a dare's subject controls their own
 * numbers, so anything purchasable or free-castable cannot be a dare.
 * Pinned by test against the canonical catalog.
 */
export const DARE_EXCLUDED_NUMERIC_FIELDS = [
  "consumablesPurchased",
  "itemsPurchased",
  "goldSpent",
  "sightWardsBoughtInGame",
  "visionWardsBoughtInGame",
  "spell1Casts",
  "spell2Casts",
  "spell3Casts",
  "spell4Casts",
  "summoner1Casts",
  "summoner2Casts",
] as const;

/** The canonical participant numeric catalog minus the self-farmable fields.
 * Derived with `.exclude` so a catalog change cannot silently diverge. */
export const DareNumericFieldSchema = ParticipantNumericFieldSchema.exclude(
  DARE_EXCLUDED_NUMERIC_FIELDS,
);
export type DareNumericField = z.infer<typeof DareNumericFieldSchema>;

/**
 * Surrender flags and `eligibleForProgression` are deliberately absent: the
 * first two are target-controllable in the wrong direction and the last is
 * meaningless as a dare.
 */
export const DareBooleanFieldSchema = z.enum([
  "win",
  "firstBloodKill",
  "firstBloodAssist",
  "firstTowerKill",
  "firstTowerAssist",
]);
export type DareBooleanField = z.infer<typeof DareBooleanFieldSchema>;

/** Code-owned derived per-game rates, computed integer-exactly from the same
 * RawMatch fields the catalog reads. Pure and dare-independent so parlays can
 * adopt them later. */
export const DareRateFieldSchema = z.enum([
  "cs_per_minute",
  "damage_per_minute",
  "kda",
]);
export type DareRateField = z.infer<typeof DareRateFieldSchema>;

const DareNumericOperatorSchema = z.enum(["gte", "lte", "eq"]);
/** No `eq` on rates: hitting exactly 7.00 CS/min is a coin toss, not a dare. */
const DareRateOperatorSchema = z.enum(["gte", "lte"]);

export const DarePredicateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("participant_numeric"),
    field: DareNumericFieldSchema,
    operator: DareNumericOperatorSchema,
    threshold: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("participant_boolean"),
    field: DareBooleanFieldSchema,
    expected: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("participant_rate"),
    field: DareRateFieldSchema,
    operator: DareRateOperatorSchema,
    /** Hundredths — see `DARE_RATE_SCALE`. */
    thresholdScaled: z.number().int().nonnegative().max(1_000_000),
  }),
]);
export type DarePredicate = z.infer<typeof DarePredicateSchema>;

export const DareCombinatorSchema = z.enum(["all", "any"]);
export type DareCombinator = z.infer<typeof DareCombinatorSchema>;

export const DareLeafSchema = z.strictObject({
  kind: z.literal("condition"),
  /** "At least N qualifying games where the predicate held." */
  requiredGames: z.number().int().min(1).max(50),
  predicate: DarePredicateSchema,
  /**
   * Normalized Data Dragon champion key (`normalizeChampionName` output), or
   * null for any champion. For a group dare, EVERY target must be on this
   * champion in a game for it to count.
   */
  champion: z.string().min(1).nullable(),
});
export type DareLeaf = z.infer<typeof DareLeafSchema>;

export const DareClauseSchema = z.strictObject({
  kind: DareCombinatorSchema,
  children: z.array(DareLeafSchema).min(1).max(4),
});
export type DareClause = z.infer<typeof DareClauseSchema>;

/**
 * Fixed depth two — a root combinator over clauses over leaves — covers
 * AND-of-ORs and OR-of-ANDs without recursive schemas, which the strict
 * structured-output translation layer could not emit anyway.
 */
export const DareConditionsSchema = z.strictObject({
  version: z.literal(DARE_CONDITION_VERSION),
  root: z.strictObject({
    kind: DareCombinatorSchema,
    clauses: z.array(DareClauseSchema).min(1).max(4),
  }),
});
export type DareConditions = z.infer<typeof DareConditionsSchema>;

/** Frozen account identity for one dare target (weekly-parlay precedent). */
export const DareFrozenAccountSchema = z.strictObject({
  puuid: z.string().min(1),
  trackingStartedAt: z.iso.datetime(),
});
export type DareFrozenAccount = z.infer<typeof DareFrozenAccountSchema>;

/** The frozen JSON stored in `BucksDareTarget.accounts`. */
export const DareTargetAccountsSchema = z.array(DareFrozenAccountSchema).min(1);

/** The frozen identity of one dare target, as evaluation and validation see
 * it: who they are for copy, and the account set that anchors candidacy. */
export type DareTargetIdentity = {
  discordId: string;
  alias: string;
  accounts: readonly DareFrozenAccount[];
};

/**
 * The canonical depth-first leaf order: clauses in stored order, then each
 * clause's children in stored order.
 *
 * `BucksDareGame.leafHits` is a positional boolean array aligned to THIS
 * order, forever — reordering it would silently reinterpret every stored
 * game row, which is why a test pins it.
 */
export function dareLeavesInCanonicalOrder(
  conditions: DareConditions,
): DareLeaf[] {
  return conditions.root.clauses.flatMap((clause) => clause.children);
}

const LeafHitsSchema = z.array(z.boolean());

/**
 * Decode one stored `BucksDareGame.leafHits` JSON blob. Lives beside
 * `dareLeavesInCanonicalOrder` because the two are one contract: each decoded
 * boolean is positional against THAT leaf order, forever.
 */
export function parseLeafHits(leafHitsJson: string): boolean[] {
  return LeafHitsSchema.parse(JSON.parse(leafHitsJson));
}

export const DARE_RATE_LABELS: Record<DareRateField, string> = {
  cs_per_minute: "CS per minute",
  damage_per_minute: "damage per minute",
  kda: "KDA",
};

/**
 * Integer-exact rate comparison via cross-multiplication — no floats.
 *
 * A participation with `timePlayed <= 0` has no per-minute rate at all, so a
 * `gte` claim is unsatisfied and an `lte` bound is vacuously satisfied; the
 * cross-multiplied form would otherwise compare against zero and answer a
 * question nobody asked. KDA uses `max(deaths, 1)` (the conventional perfect
 * game) and does not involve time.
 */
function evaluateDareRatePredicate(
  predicate: Extract<DarePredicate, { kind: "participant_rate" }>,
  participant: RawParticipant,
): boolean {
  if (predicate.field === "kda") {
    const kills = participantNumericValue(participant, "kills");
    const assists = participantNumericValue(participant, "assists");
    const deaths = participantNumericValue(participant, "deaths");
    if (kills === undefined || assists === undefined || deaths === undefined) {
      return false;
    }
    const lhs = (kills + assists) * DARE_RATE_SCALE;
    const rhs = predicate.thresholdScaled * Math.max(deaths, 1);
    return predicate.operator === "gte" ? lhs >= rhs : lhs <= rhs;
  }
  const seconds = participantNumericValue(participant, "timePlayed");
  if (seconds === undefined) {
    return false;
  }
  if (seconds <= 0) {
    return predicate.operator === "lte";
  }
  const total =
    predicate.field === "cs_per_minute"
      ? (participantNumericValue(participant, "totalMinionsKilled") ?? 0) +
        (participantNumericValue(participant, "neutralMinionsKilled") ?? 0)
      : participantNumericValue(participant, "totalDamageDealtToChampions");
  if (total === undefined) {
    return false;
  }
  const lhs = total * 60 * DARE_RATE_SCALE;
  const rhs = predicate.thresholdScaled * seconds;
  return predicate.operator === "gte" ? lhs >= rhs : lhs <= rhs;
}

/**
 * Did this participant satisfy the predicate in this game?
 *
 * An absent field never satisfies a predicate, in either direction: the fact
 * was not observed, and counts that only grow keep that answer monotone.
 */
export function evaluateDarePredicate(
  predicate: DarePredicate,
  participant: RawParticipant,
): boolean {
  if (predicate.kind === "participant_numeric") {
    const actual = participantNumericValue(participant, predicate.field);
    if (actual === undefined) return false;
    return compare(actual, predicate.operator, predicate.threshold);
  }
  if (predicate.kind === "participant_boolean") {
    const actual = participantBooleanValue(participant, predicate.field);
    if (actual === undefined) return false;
    return actual === predicate.expected;
  }
  return evaluateDareRatePredicate(predicate, participant);
}

/** Frozen per-target facts recorded with each captured game, for audit only —
 * settlement re-reads `leafHits`, never this. */
const DareGameSnapshotSchema = z.strictObject({
  teamId: z.number().int(),
  targets: z
    .array(
      z.strictObject({
        discordId: z.string().min(1),
        alias: z.string().min(1),
        puuid: z.string().min(1),
        champion: z.string().min(1),
        win: z.boolean(),
        kills: z.number().int().nonnegative(),
        deaths: z.number().int().nonnegative(),
        assists: z.number().int().nonnegative(),
        timePlayed: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
type DareGameSnapshot = z.infer<typeof DareGameSnapshotSchema>;

export type DareGameEvaluation = {
  /** Aligned to `dareLeavesInCanonicalOrder` — index-stable forever. */
  leafHits: boolean[];
  snapshot: DareGameSnapshot;
};

/**
 * Evaluate one ingested game against one dare.
 *
 * The game is a candidate iff EVERY target appears (through any frozen PUUID)
 * and all matched participants share one `teamId`; anything else returns
 * undefined and the game simply does not count. A leaf hits iff every
 * target's participant satisfies its predicate and — when the leaf names a
 * champion — played exactly that champion (normalized Data Dragon key).
 */
export function evaluateDareGame(
  conditions: DareConditions,
  targets: readonly DareTargetIdentity[],
  matchData: RawMatch,
): DareGameEvaluation | undefined {
  if (targets.length === 0) return undefined;
  const participantByPuuid = new Map(
    matchData.info.participants.map((participant) => [
      participant.puuid,
      participant,
    ]),
  );
  const matched: { target: DareTargetIdentity; participant: RawParticipant }[] =
    [];
  for (const target of targets) {
    const participant = target.accounts
      .map((account) => participantByPuuid.get(account.puuid))
      .find((candidate) => candidate !== undefined);
    if (participant === undefined) return undefined;
    matched.push({ target, participant });
  }
  const teamIds = new Set(matched.map((entry) => entry.participant.teamId));
  const [teamId] = teamIds;
  if (teamId === undefined || teamIds.size !== 1) return undefined;

  const leafHits = dareLeavesInCanonicalOrder(conditions).map((leaf) =>
    matched.every(
      ({ participant }) =>
        (leaf.champion === null ||
          normalizeChampionName(participant.championName) === leaf.champion) &&
        evaluateDarePredicate(leaf.predicate, participant),
    ),
  );
  const snapshot = DareGameSnapshotSchema.parse({
    teamId,
    targets: matched.map(({ target, participant }) => ({
      discordId: target.discordId,
      alias: target.alias,
      puuid: participant.puuid,
      champion: normalizeChampionName(participant.championName),
      win: participant.win,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      timePlayed: participant.timePlayed,
    })),
  });
  return { leafHits, snapshot };
}

export type DareTreeEvaluation = {
  achieved: boolean;
  /** Qualifying-game hit count per leaf, in canonical order. */
  leafCounts: number[];
};

/**
 * Evaluate the whole tree over every captured game row.
 *
 * A leaf is true iff its hit count reached `requiredGames`. Counts only grow,
 * so `achieved` is monotone in the row set — adding rows can never flip it
 * back to false, which is what makes settling the moment it turns true safe.
 */
export function evaluateDareTree(
  conditions: DareConditions,
  gameRows: readonly { leafHits: readonly boolean[] }[],
): DareTreeEvaluation {
  const leaves = dareLeavesInCanonicalOrder(conditions);
  const leafCounts = leaves.map(
    (_leaf, index) =>
      gameRows.filter((row) => row.leafHits[index] === true).length,
  );
  let offset = 0;
  const clauseTruths = conditions.root.clauses.map((clause) => {
    const truths = clause.children.map((leaf, childIndex) => {
      const count = leafCounts[offset + childIndex];
      if (count === undefined) {
        throw new Error("Dare leaf counts fell out of canonical alignment");
      }
      return count >= leaf.requiredGames;
    });
    offset += clause.children.length;
    return clause.kind === "all" ? truths.every(Boolean) : truths.some(Boolean);
  });
  const achieved =
    conditions.root.kind === "all"
      ? clauseTruths.every(Boolean)
      : clauseTruths.some(Boolean);
  return { achieved, leafCounts };
}

export function formatDareRateThreshold(thresholdScaled: number): string {
  const whole = Math.floor(thresholdScaled / DARE_RATE_SCALE).toString();
  const cents = thresholdScaled % DARE_RATE_SCALE;
  if (cents === 0) return whole;
  const fraction = cents.toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}.${fraction}`;
}

function comparisonWord(operator: "gte" | "lte" | "eq"): string {
  if (operator === "gte") return "at least";
  if (operator === "lte") return "at most";
  return "exactly";
}

function renderDarePredicate(predicate: DarePredicate, who: string): string {
  if (predicate.kind === "participant_numeric") {
    const label = PARTICIPANT_NUMERIC_CATALOG[predicate.field].label;
    return `${who} gets ${comparisonWord(predicate.operator)} ${formatParlayNumericValue(predicate.field, predicate.threshold)} ${label}`;
  }
  if (predicate.kind === "participant_boolean") {
    if (predicate.field === "win") {
      return predicate.expected ? `${who} wins` : `${who} does not win`;
    }
    const label = PARTICIPANT_BOOLEAN_CATALOG[predicate.field].label;
    return predicate.expected
      ? `${who} gets ${label}`
      : `${who} does not get ${label}`;
  }
  return `${who} averages ${comparisonWord(predicate.operator)} ${formatDareRateThreshold(predicate.thresholdScaled)} ${DARE_RATE_LABELS[predicate.field]}`;
}

function renderDareLeaf(leaf: DareLeaf, who: string): string {
  const suffix =
    leaf.champion === null
      ? ""
      : ` on ${championNameToDisplayName(leaf.champion)}`;
  const games = `${leaf.requiredGames.toString()} ${countLabel(leaf.requiredGames, "game")}`;
  return `at least ${games} where ${renderDarePredicate(leaf.predicate, who)}${suffix}`;
}

function formatAliasList(aliases: readonly string[]): string {
  if (aliases.length <= 1) return aliases[0] ?? "the target";
  if (aliases.length === 2) return aliases.join(" and ");
  return `${aliases.slice(0, -1).join(", ")}, and ${aliases.at(-1) ?? ""}`;
}

function combinatorHeader(kind: DareCombinator): string {
  return kind === "all" ? "ALL of:" : "ANY of:";
}

/**
 * THE human description of a dare — always rendered by code from the stored
 * tree, never from model prose. The challenger confirms exactly this text,
 * and ledger contexts freeze it as `conditionSummary`.
 */
function renderDareClause(
  clause: DareClause,
  who: string,
  indent: string,
): string[] {
  const [soloLeaf] = clause.children;
  if (soloLeaf !== undefined && clause.children.length === 1) {
    return [`${indent}- ${renderDareLeaf(soloLeaf, who)}`];
  }
  return [
    `${indent}- ${combinatorHeader(clause.kind)}`,
    ...clause.children.map(
      (leaf) => `${indent}  - ${renderDareLeaf(leaf, who)}`,
    ),
  ];
}

function renderDareTree(conditions: DareConditions, who: string): string[] {
  const [onlyClause] = conditions.root.clauses;
  if (onlyClause !== undefined && conditions.root.clauses.length === 1) {
    const [onlyLeaf] = onlyClause.children;
    if (onlyLeaf !== undefined && onlyClause.children.length === 1) {
      return [renderDareLeaf(onlyLeaf, who)];
    }
    return [
      combinatorHeader(onlyClause.kind),
      ...onlyClause.children.map((leaf) => `- ${renderDareLeaf(leaf, who)}`),
    ];
  }
  return [
    combinatorHeader(conditions.root.kind),
    ...conditions.root.clauses.flatMap((clause) =>
      renderDareClause(clause, who, ""),
    ),
  ];
}

export function renderDareConditions(
  conditions: DareConditions,
  targetAliases: readonly string[],
): string {
  const who = formatAliasList(targetAliases);
  const lines = renderDareTree(conditions, who);
  if (targetAliases.length > 1) {
    lines.push(
      `Counts only games where ${who} play together on the same team.`,
    );
  }
  return lines.join("\n");
}

/**
 * Cross-field checks the schemas cannot express. Empty means valid.
 *
 * Two targets sharing a frozen PUUID would trivialize same-match candidacy,
 * a `next_game` horizon binds exactly one game, so no leaf may require more
 * than one, and a champion-bound leaf on a group dare is unachievable from
 * creation: a leaf hits only when EVERY target played that champion, and the
 * eligible queues are all draft modes where a champion appears at most once
 * per match.
 */
export function dareSemanticIssues(
  targets: readonly DareTargetIdentity[],
  conditions: DareConditions,
  horizonKind: BucksDareHorizonKind,
): string[] {
  const leaves = dareLeavesInCanonicalOrder(conditions);
  const groupIssue =
    targets.length > 1 && leaves.some((leaf) => leaf.champion !== null)
      ? "A dare on multiple targets cannot pin a champion — only one player can play a champion per draft game, so the condition could never be met"
      : undefined;
  const horizonIssue =
    horizonKind === "next_game" &&
    leaves.some((leaf) => leaf.requiredGames !== 1)
      ? "A next-game dare binds exactly one game, so every condition must be achievable in it"
      : undefined;
  return [
    ...duplicateTargetIssues(targets),
    ...sharedAccountIssues(targets),
    ...(groupIssue === undefined ? [] : [groupIssue]),
    ...(horizonIssue === undefined ? [] : [horizonIssue]),
  ];
}

function duplicateTargetIssues(
  targets: readonly DareTargetIdentity[],
): string[] {
  const issues: string[] = [];
  const seenDiscordIds = new Set<string>();
  for (const target of targets) {
    if (seenDiscordIds.has(target.discordId)) {
      issues.push(`Target ${target.alias} is listed more than once`);
    }
    seenDiscordIds.add(target.discordId);
  }
  return issues;
}

/** Two targets sharing a frozen PUUID would trivialize same-match candidacy. */
function sharedAccountIssues(targets: readonly DareTargetIdentity[]): string[] {
  const issues: string[] = [];
  const puuidOwners = new Map<string, string>();
  for (const target of targets) {
    for (const account of target.accounts) {
      const owner = puuidOwners.get(account.puuid);
      if (owner !== undefined && owner !== target.discordId) {
        issues.push(
          `Targets share a linked League account, so the group can never be told apart`,
        );
      }
      puuidOwners.set(account.puuid, target.discordId);
    }
  }
  return issues;
}
