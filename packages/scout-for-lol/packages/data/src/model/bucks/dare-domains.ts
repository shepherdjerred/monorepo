import { z } from "zod";
import {
  getChampionByKey,
  normalizeChampionName,
} from "#src/model/riot/champion-registry.ts";
import { QueueTypeSchema } from "#src/model/core/state.ts";
import type {
  DareBooleanExpressionV2,
  DareValueV2,
} from "#src/model/bucks/dare-expression-v2.ts";

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
 * tournament lobby events in `raw-tournament.schema.ts`. Recognising an event is
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
 * Keyed by column name so one table serves both contract shapes: a v2 contract
 * compares a typed `DareValueV2` field, a v3 contract compares a SQL column in
 * its frozen AST, and both resolve to the same report-lake column. Keeping the
 * domains here rather than in either contract module is what stops the two
 * enforcement points from disagreeing.
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
 * or as the punctuated display name (`Twisted Fate`) — the committed paraphrase
 * corpus stores the latter, and the evaluator normalizes before comparing. So
 * "valid" means "the registry resolves it", not "it is already canonical".
 */
function championResolves(champion: string): boolean {
  // `normalizeChampionName` percent-decodes and throws a URIError on a malformed
  // escape (a model champion such as "100% crit Yasuo"). Dare v1 documents the
  // same trap in `dare-model-schema.ts`; a throw and an unresolved name are the
  // same answer here.
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
 * The report-lake column a value resolves to, or null when it has no closed
 * domain. Participant field names are already the lake column names, so the
 * only translation needed is the game-level `queue`.
 */
function dareDomainColumnForValue(value: DareValueV2): DareDomainColumn | null {
  if (value.kind === "participant") {
    return value.field === "champion_name" || value.field === "team_position"
      ? value.field
      : null;
  }
  return value.kind === "game" && value.field === "queue" ? "queue" : null;
}

function issueList(issue: string | null): string[] {
  return issue === null ? [] : [issue];
}

type DareTimelineEventCountV2 = Extract<
  DareValueV2,
  { kind: "timeline_event_count" }
>;

/**
 * The event type each narrowing field belongs to.
 *
 * Riot writes `monster_type` only on `ELITE_MONSTER_KILL` and `building_type`
 * only on `BUILDING_KILL`; on every other event type both columns are null. So
 * `eventType: "CHAMPION_KILL"` with `monsterType: "DRAGON"` is not merely
 * redundant — it is a predicate no game can ever satisfy, which counts zero,
 * reads as a definite failure, and settles `unachieved` with a house cut. That
 * is the `team_position = 'MID'` failure wearing a different hat.
 */
function narrowingEventTypeIssue(
  eventType: string,
  required: string,
  field: string,
): string | null {
  return eventType === required
    ? null
    : `${field} narrows ${required} events, but this value counts ${eventType} events, which never carry that field. The predicate would count zero in every game.`;
}

function dareTimelineNarrowingIssues(
  value: DareTimelineEventCountV2,
): string[] {
  const { monsterType, buildingType } = value;
  if (monsterType !== null && buildingType !== null) {
    return [
      "A timeline event is either an elite monster kill or a building kill, never both. Narrow by monsterType or by buildingType, not both.",
    ];
  }
  if (monsterType !== null) {
    return [
      ...issueList(dareDomainIssue("monster_type", monsterType)),
      ...issueList(
        narrowingEventTypeIssue(
          value.eventType,
          "ELITE_MONSTER_KILL",
          "monsterType",
        ),
      ),
    ];
  }
  if (buildingType !== null) {
    return [
      ...issueList(dareDomainIssue("building_type", buildingType)),
      ...issueList(
        narrowingEventTypeIssue(
          value.eventType,
          "BUILDING_KILL",
          "buildingType",
        ),
      ),
    ];
  }
  return [];
}

/**
 * Event types that belong to a side rather than to the match.
 *
 * A dragon or a tower is taken *by a team*, so "at least three dragons" without
 * a bound target counts both teams and an enemy objective settles the dare —
 * which is the one thing a funded contract must never do.
 *
 * A team-relative filter is deliberately not offered, because it cannot be made
 * correct for both of these here. `killer_team_id` answers it exactly for an
 * elite monster, but `BUILDING_KILL` carries no such column: it carries
 * `team_id`, whose meaning (the team that owned the structure, not the team that
 * destroyed it) is pinned by nothing in this repository — no fixture, no lake
 * row, no schema comment — and a filter built on the wrong reading inverts the
 * dare, which is worse than counting too much. Resolving the side through the
 * event's `killer` participant instead is exact for monsters but silently
 * under-counts buildings finished by minions, and an under-count settles as a
 * real loss. A field that is sound for one of the two and quietly wrong for the
 * other is exactly the trap this module exists to remove, so the unsound case is
 * refused rather than approximated.
 *
 * Binding a target keeps every objective dare attributable to a person the plain
 * language names: "Virmel's BUILDING_KILL timeline events of TOWER_BUILDING as
 * killer". Lifting this needs `BUILDING_KILL.team_id` verified against the beta
 * lake first.
 */
const DARE_TEAM_OWNED_EVENT_TYPES = new Set<string>([
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
]);

function dareObjectiveAttributionIssue(
  value: DareTimelineEventCountV2,
): string | null {
  if (!DARE_TEAM_OWNED_EVENT_TYPES.has(value.eventType)) return null;
  if (value.target === null) {
    return `${value.eventType} events belong to the side that took the objective, so leaving target null counts both teams and an enemy objective would settle the dare. Bind target to the player who takes it, with role "killer" or "assist". A team-relative objective count is not expressible in a version-two contract.`;
  }
  // Binding the target is not enough: the evaluator filters on the exact role,
  // and only `killer` and `assist` attribute an objective to the player who took
  // it. `victim`, `subject`, and `creator` never appear on these events, so such
  // a contract counts zero in every game and settles a funded dare as a real
  // loss — the same silent-impossibility this module exists to refuse.
  return value.role === "killer" || value.role === "assist"
    ? null
    : `${value.eventType} events attribute to the player who took the objective, so role must be "killer" or "assist"; ${value.role === null ? "null" : `"${value.role}"`} never appears on these events and would count zero in every game.`;
}

/**
 * Domain issues carried by a value itself, independent of any threshold.
 *
 * A closed-domain field that lives *on* a value never reaches
 * `dareBooleanDomainIssuesV2`: that walk resolves a column from what the
 * comparison reads, so it only ever inspects the comparison's own threshold.
 * `related_participant_count.championName` and every `timeline_event_count`
 * filter are applied by the value before it produces a number, so they have to
 * be checked here or they are not checked at all.
 */
export function dareValueDomainIssuesV2(value: DareValueV2): string[] {
  if (value.kind === "arithmetic") {
    return [
      ...dareValueDomainIssuesV2(value.left),
      ...dareValueDomainIssuesV2(value.right),
    ];
  }
  if (value.kind === "related_participant_count") {
    return value.championName === null
      ? []
      : issueList(dareDomainIssue("champion_name", value.championName));
  }
  if (value.kind === "timeline_event_count") {
    return [
      ...issueList(dareDomainIssue("event_type", value.eventType)),
      ...dareTimelineNarrowingIssues(value),
      ...issueList(dareObjectiveAttributionIssue(value)),
    ];
  }
  return [];
}

/**
 * Every domain violation in a predicate.
 *
 * Exported so the schema's hard gate and the compiler's friendly semantic pass
 * run one implementation and cannot drift apart.
 */
export function dareBooleanDomainIssuesV2(
  expression: DareBooleanExpressionV2,
): string[] {
  if (expression.kind === "comparison") {
    const issues = dareValueDomainIssuesV2(expression.value);
    const column = dareDomainColumnForValue(expression.value);
    if (column === null) return issues;
    const issue = dareDomainIssue(column, expression.threshold);
    return issue === null ? issues : [...issues, issue];
  }
  if (expression.kind === "not") {
    return dareBooleanDomainIssuesV2(expression.operand);
  }
  return expression.operands.flatMap((operand) =>
    dareBooleanDomainIssuesV2(operand),
  );
}

/**
 * Domain issues across a game set's predicate and its projections.
 *
 * Takes the two members it reads rather than the whole game set, so this module
 * stays independent of the contract schema that calls it.
 */
export function dareGameSetDomainIssuesV2(gameSet: {
  predicate: DareBooleanExpressionV2;
  projections: readonly { value: DareValueV2 }[];
}): string[] {
  return [
    ...dareBooleanDomainIssuesV2(gameSet.predicate),
    ...gameSet.projections.flatMap((projection) =>
      dareValueDomainIssuesV2(projection.value),
    ),
  ];
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
