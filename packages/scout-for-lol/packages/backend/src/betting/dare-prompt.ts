import {
  DARE_DEFAULT_WINDOW_DAYS,
  DARE_MAX_CLAUSES,
  DARE_MAX_LEAVES,
  DARE_MAX_TARGETS,
  DARE_MAX_WINDOW_DAYS,
} from "#src/betting/constants.ts";
import {
  DareBooleanFieldSchema,
  DareNumericFieldSchema,
  DareRateFieldSchema,
  type DareBooleanField,
  type DareNumericField,
  type DareRateField,
} from "#src/betting/dare-criteria.ts";
import type { DareShortlistEntry } from "#src/betting/dare-shortlist.ts";

/**
 * Prompts for the `/bb dare` translation call.
 *
 * Version bumps when the wording changes meaningfully; the version is frozen
 * onto each dare's translation record so a stored dare can always say which
 * prompt produced it.
 */
export const DARE_PROMPT_VERSION = "1";

/**
 * One line per field, keyed exhaustively by the schema's own type so a
 * catalog change here is a compile error, and the enumerated list itself is
 * always derived from the schema's `.options` — never hand-typed.
 */
const NUMERIC_FIELD_MEANINGS: Record<DareNumericField, string> = {
  assists: "kill assists",
  baronKills: "Baron Nashor kills by the player",
  champExperience: "total champion experience earned",
  champLevel: "final champion level",
  damageDealtToBuildings: "damage dealt to buildings",
  damageDealtToObjectives: "damage dealt to epic objectives",
  damageDealtToTurrets: "damage dealt to turrets",
  damageSelfMitigated: "damage mitigated on self",
  deaths: "deaths",
  detectorWardsPlaced: "control wards placed",
  doubleKills: "double kills",
  dragonKills: "dragon kills by the player",
  goldEarned: "total gold earned",
  inhibitorKills: "inhibitor last-hits",
  inhibitorTakedowns: "inhibitor takedowns (kill or assist)",
  inhibitorsLost: "own team's inhibitors lost",
  killingSprees: "killing sprees started",
  kills: "champion kills",
  largestCriticalStrike: "largest critical strike",
  largestKillingSpree: "largest killing spree",
  largestMultiKill: "largest multikill (2 = double, 5 = penta)",
  longestTimeSpentLiving: "longest time alive, in seconds",
  magicDamageDealt: "total magic damage dealt",
  magicDamageDealtToChampions: "magic damage dealt to champions",
  magicDamageTaken: "magic damage taken",
  neutralMinionsKilled: "jungle monsters killed",
  nexusKills: "nexus last-hits",
  nexusLost: "own nexus lost (0 or 1)",
  nexusTakedowns: "nexus takedowns (kill or assist)",
  objectivesStolen: "epic objectives stolen",
  objectivesStolenAssists: "assists on stolen objectives",
  pentaKills: "penta kills",
  physicalDamageDealt: "total physical damage dealt",
  physicalDamageDealtToChampions: "physical damage dealt to champions",
  physicalDamageTaken: "physical damage taken",
  quadraKills: "quadra kills",
  timeCCingOthers: "seconds spent crowd-controlling enemies",
  timePlayed: "seconds played in the game",
  totalAllyJungleMinionsKilled: "own-jungle monsters killed",
  totalDamageDealt: "total damage dealt",
  totalDamageDealtToChampions: "total damage dealt to champions",
  totalDamageShieldedOnTeammates: "damage shielded on teammates",
  totalDamageTaken: "total damage taken",
  totalEnemyJungleMinionsKilled: "enemy-jungle monsters stolen",
  totalHeal: "total healing done",
  totalHealsOnTeammates: "healing done on teammates",
  totalMinionsKilled: "lane minions killed (CS from lane)",
  totalTimeCCDealt: "total crowd-control time dealt",
  totalTimeSpentDead: "seconds spent dead",
  totalUnitsHealed: "distinct units healed",
  tripleKills: "triple kills",
  trueDamageDealt: "total true damage dealt",
  trueDamageDealtToChampions: "true damage dealt to champions",
  trueDamageTaken: "true damage taken",
  turretKills: "turret last-hits",
  turretTakedowns: "turret takedowns (kill or assist)",
  turretsLost: "own team's turrets lost",
  unrealKills: "kills beyond a penta",
  visionScore: "vision score",
  wardsKilled: "enemy wards destroyed",
  wardsPlaced: "wards placed",
};

const BOOLEAN_FIELD_MEANINGS: Record<DareBooleanField, string> = {
  win: "the player won the game",
  firstBloodKill: "the player got first blood",
  firstBloodAssist: "the player assisted first blood",
  firstTowerKill: "the player killed the first tower",
  firstTowerAssist: "the player assisted the first tower kill",
};

const RATE_FIELD_MEANINGS: Record<DareRateField, string> = {
  cs_per_minute: "creep score per minute (lane + jungle)",
  damage_per_minute: "champion damage per minute",
  kda: "(kills + assists) / deaths, deaths floored at 1",
};

function fieldLines<FIELD extends string>(
  options: readonly FIELD[],
  meanings: Record<FIELD, string>,
): string {
  return options.map((field) => `- ${field}: ${meanings[field]}`).join("\n");
}

export const DARE_TRANSLATION_SYSTEM_PROMPT = `You translate one free-text League of Legends dare into a structured achievement bounty. Return only the requested structured object. Use only the supplied target list and the closed field catalogs. Never emit paths, code, SQL, expressions, IDs, or settlement prose, and never invent a field, target, or value outside the schema. When the dare cannot be expressed exactly, answer unmappable=true with a short reason instead of guessing.`;

/** The model sees keys and aliases only — never Discord or Riot identities. */
function promptTargets(
  shortlist: readonly DareShortlistEntry[],
): { key: string; alias: string }[] {
  return shortlist.map((entry) => ({ key: entry.key, alias: entry.alias }));
}

export function buildDareTranslationPrompt(input: {
  text: string;
  shortlist: readonly DareShortlistEntry[];
}): string {
  return [
    "Translate the dare text below into one structured achievement bounty.",
    [
      "This is a one-sided BOUNTY on the named players (the targets): they win by ACHIEVING something.",
      `Normalize doubt into the achievement: "I bet X can't do Y" means the dare is that X does Y.`,
      "Never negate: express what the targets must accomplish, not what they must avoid.",
    ].join("\n"),
    [
      `Targets: choose 1-${DARE_MAX_TARGETS.toString()} keys from the list at the end, exactly as written, no duplicates.`,
      "Naming several players makes a group dare: they must achieve it together, in shared games.",
      "If the text names someone who is not on the list, answer unmappable with the name in the reason.",
    ].join("\n"),
    [
      "Conditions form a two-level tree: a root combinator over clauses over leaves.",
      `Set rootCombinator and one combinator per clause in clauseCombinators (1-${DARE_MAX_CLAUSES.toString()} clauses): "all" for AND, "any" for OR, following the text's own and/or structure. A single requirement is one "all" clause with one leaf.`,
      `Each leaf (1-${DARE_MAX_LEAVES.toString()} total, at most 4 per clause) sets clauseIndex to its clause's position, starting at 0, leaving no clause empty.`,
      `requiredGames is "at least N qualifying games where the per-game condition held" — take N from counts in the text ("win 7 games" is requiredGames 7 on a win leaf); a claim about a single game is requiredGames 1.`,
    ].join("\n"),
    [
      "Each leaf fills only the slots its kind uses and sets every other slot to null:",
      "- participant_numeric: numericField, operator (gte/lte/eq), threshold (integer).",
      "- participant_boolean: booleanField, expected (true/false).",
      "- participant_rate: rateField, operator (gte or lte only — never eq), thresholdScaled in HUNDREDTHS (7 CS per minute is 700; a 3.5 KDA is 350).",
      `Set a leaf's champion when the text ties it to one champion (use the champion's name); otherwise null.`,
    ].join("\n"),
    [
      `Horizon: an explicit "next game" is horizonKind next_game (windowDays null, every requiredGames 1).`,
      `Everything else is horizonKind window: "this week" is windowDays 7, "this month" is windowDays ${DARE_MAX_WINDOW_DAYS.toString()}, an explicit day count is that count capped at ${DARE_MAX_WINDOW_DAYS.toString()}.`,
      `When the text names no timeframe, leave windowDays null — the default of ${DARE_DEFAULT_WINDOW_DAYS.toString()} days is applied for you; never write the default yourself.`,
    ].join("\n"),
    [
      "Prefer unmappable=true with a short reason over guessing. Always unmappable:",
      `- "maintain / keep it up / every single game" claims — a condition that must hold in EVERY game is not expressible; only "at least N games where..." is.`,
      "- statistics outside the catalogs below.",
      "- player names not on the target list.",
      "When unmappable is true, set unmappableReason and leave targets, clauseCombinators, and leaves as empty arrays.",
    ].join("\n"),
    `Numeric fields (per game, integers):\n${fieldLines(DareNumericFieldSchema.options, NUMERIC_FIELD_MEANINGS)}`,
    `Boolean fields (per game):\n${fieldLines(DareBooleanFieldSchema.options, BOOLEAN_FIELD_MEANINGS)}`,
    `Rate fields (per game, thresholds in hundredths):\n${fieldLines(DareRateFieldSchema.options, RATE_FIELD_MEANINGS)}`,
    `Available targets:\n${JSON.stringify(promptTargets(input.shortlist))}`,
    `Dare text:\n${input.text}`,
  ].join("\n\n");
}
