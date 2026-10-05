import { z } from "zod";
import {
  getChampionByKey,
  normalizeChampionName,
} from "#src/model/riot/champion-registry.ts";
import { QueueTypeSchema } from "#src/model/core/state.ts";

/**
 * Riot's `teamPosition` domain as it appears in match data and the report lake.
 *
 * Deliberately NOT `PositionSchema` (`#src/league/enums.ts`), which also admits
 * `""` and `"Invalid"`. Those are real wire values — a participant in a mode
 * without assigned roles carries them — but they must never be authored as a
 * Dare threshold, because a dare on an empty position is unsatisfiable in
 * exactly the way this module exists to prevent.
 */
export const DARE_TEAM_POSITIONS = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
] as const;
export const DareTeamPositionSchema = z.enum(DARE_TEAM_POSITIONS);
export type DareTeamPosition = z.infer<typeof DareTeamPositionSchema>;

/**
 * Riot timeline event types a Dare contract may count.
 *
 * Derived from the beta report lake — every distinct `event_type` across ~1.5M
 * events — not from memory: `PAUSE_START` and `FEAT_UPDATE` are real and easy to
 * omit, while `BUILDING_DESTROYED` (named in an old docs table) does not exist.
 * `DRAGON_KILL` does not exist either; a dragon is an `ELITE_MONSTER_KILL`.
 *
 * This list is deliberately an authoring-side constraint only. The wire schema
 * (`raw-timeline.schema.ts`) and the lake column stay open strings, because a
 * new Riot event type modelled as an enum at ingestion would fail the parse and
 * take down timeline processing entirely — the argument already written down for
 * managed custom-game events. Recognising an event is
 * a decision one layer up; here, at the point someone writes a contract, an
 * unrecognised type can only ever produce a count of zero, which settles as a
 * real loss.
 */
export const DARE_TIMELINE_EVENT_TYPES = [
  "BUILDING_KILL",
  "CHAMPION_KILL",
  "CHAMPION_SPECIAL_KILL",
  "CHAMPION_TRANSFORM",
  "DRAGON_SOUL_GIVEN",
  "ELITE_MONSTER_KILL",
  "FEAT_UPDATE",
  "GAME_END",
  "ITEM_DESTROYED",
  "ITEM_PURCHASED",
  "ITEM_SOLD",
  "ITEM_UNDO",
  "LEVEL_UP",
  "OBJECTIVE_BOUNTY_FINISH",
  "OBJECTIVE_BOUNTY_PRESTART",
  "PAUSE_END",
  "PAUSE_START",
  "SKILL_LEVEL_UP",
  "TURRET_PLATE_DESTROYED",
  "WARD_KILL",
  "WARD_PLACED",
] as const;
export const DareTimelineEventTypeSchema = z.enum(DARE_TIMELINE_EVENT_TYPES);
export type DareTimelineEventType = z.infer<typeof DareTimelineEventTypeSchema>;

/**
 * Elite monsters, as `monster_type` records them.
 *
 * Also from the beta lake, and the reason objective dares need this field at
 * all: every one of these is an `ELITE_MONSTER_KILL`, so the event type alone
 * cannot tell a dragon from a baron.
 */
export const DARE_MONSTER_TYPES = [
  "ATAKHAN",
  "BARON_NASHOR",
  "DRAGON",
  "HORDE",
  "RIFTHERALD",
] as const;
export const DareMonsterTypeSchema = z.enum(DARE_MONSTER_TYPES);

/** Structures, as `building_type` records them. */
export const DARE_BUILDING_TYPES = [
  "INHIBITOR_BUILDING",
  "TOWER_BUILDING",
] as const;
export const DareBuildingTypeSchema = z.enum(DARE_BUILDING_TYPES);

/**
 * Lake columns whose values are drawn from a closed set.
 *
 * Keyed by report-lake column name: a contract compares a SQL column in its
 * frozen AST, and the compiler checks each literal compared against one of
 * these columns here, so the authoring tool's catalog and the compiler's
 * check cannot disagree.
 */
export const DARE_DOMAIN_COLUMNS = [
  "champion_name",
  "team_position",
  "queue",
  "event_type",
  "monster_type",
  "building_type",
] as const;
export const DareDomainColumnSchema = z.enum(DARE_DOMAIN_COLUMNS);
export type DareDomainColumn = z.infer<typeof DareDomainColumnSchema>;

/**
 * A champion threshold may be written either as a Data Dragon key (`TwistedFate`)
 * or as the punctuated display name (`Twisted Fate`), so "valid" means "the
 * registry resolves it", not "it is already canonical".
 */
function championResolves(champion: string): boolean {
  // `normalizeChampionName` percent-decodes and throws a URIError on a malformed
  // escape (a model champion such as "100% crit Yasuo"); a throw and an
  // unresolved name are the same answer here.
  try {
    return getChampionByKey(normalizeChampionName(champion)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Every closed-domain column, keyed so adding one is a single table entry rather
 * than another branch — and so the column list and the checks cannot drift.
 */
const DARE_COLUMN_DOMAINS: Record<
  DareDomainColumn,
  { readonly noun: string; readonly values: readonly string[] }
> = {
  team_position: {
    noun: "a team position",
    values: DARE_TEAM_POSITIONS,
  },
  queue: { noun: "a queue", values: QueueTypeSchema.options },
  event_type: {
    noun: "a timeline event type",
    values: DARE_TIMELINE_EVENT_TYPES,
  },
  monster_type: { noun: "an elite monster", values: DARE_MONSTER_TYPES },
  building_type: { noun: "a building type", values: DARE_BUILDING_TYPES },
  // Champions are the one open-ended domain: ~170 keys plus display names and
  // aliases, resolved through the registry rather than listed back at the author.
  champion_name: { noun: "a known champion", values: [] },
};

/**
 * Returns a human-readable issue when `threshold` is outside `column`'s domain,
 * or null when it is in-domain.
 *
 * This is the check whose absence let `team_position = 'MID'` compile, freeze,
 * render in plain English, and settle as a funded loss: Riot writes `MIDDLE`, so
 * the predicate was false for every game that could ever be played.
 */
export function dareDomainIssue(
  column: DareDomainColumn,
  threshold: string | number | boolean,
): string | null {
  if (typeof threshold !== "string") {
    return `${column} must be compared against a string value.`;
  }
  if (column === "champion_name") {
    return championResolves(threshold)
      ? null
      : `"${threshold}" is not a known champion.`;
  }
  const domain = DARE_COLUMN_DOMAINS[column];
  return domain.values.includes(threshold)
    ? null
    : `"${threshold}" is not ${domain.noun}. Use one of ${domain.values.join(", ")}.`;
}

/**
 * The closed domains, shaped for the authoring tool's language response.
 *
 * The model had no source of truth for these anywhere — not in the prompt, not
 * in a tool description, and (before the event-type enum) not in the JSON
 * Schema either. It was inferring them, which is how `team_position = 'MID'`
 * reached three funded contracts when Riot writes `MIDDLE`. Champions are
 * omitted deliberately: ~170 keys is not a useful thing to recite, and the
 * registry resolves display names anyway.
 */
export function dareValueDomainCatalog(): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.entries(DARE_COLUMN_DOMAINS)
      .filter(([, domain]) => domain.values.length > 0)
      .map(([column, domain]) => [column, domain.values]),
  );
}
