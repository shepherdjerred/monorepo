import { z } from "zod";
import {
  getChampionByKey,
  normalizeChampionName,
} from "#src/model/champion-registry.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import type {
  DareBooleanExpressionV2,
  DareValueV2,
} from "#src/model/dare-expression-v2.ts";

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
  if (column === "team_position") {
    return DareTeamPositionSchema.safeParse(threshold).success
      ? null
      : `"${threshold}" is not a team position. Use one of ${DARE_TEAM_POSITIONS.join(", ")}.`;
  }
  if (column === "queue") {
    return QueueTypeSchema.safeParse(threshold).success
      ? null
      : `"${threshold}" is not a queue. Use one of ${QueueTypeSchema.options.join(", ")}.`;
  }
  if (column === "event_type") {
    return DareTimelineEventTypeSchema.safeParse(threshold).success
      ? null
      : `"${threshold}" is not a timeline event type. Use one of ${DARE_TIMELINE_EVENT_TYPES.join(", ")}.`;
  }
  return championResolves(threshold)
    ? null
    : `"${threshold}" is not a known champion.`;
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

/**
 * Domain issues carried by a value itself, independent of any threshold.
 *
 * A closed-domain field that lives *on* a value never reaches
 * `dareBooleanDomainIssuesV2`: that walk resolves a column from what the
 * comparison reads, so it only ever inspects the comparison's own threshold.
 * `related_participant_count.championName` and `timeline_event_count.eventType`
 * are filters the value applies before it produces a number, so they have to be
 * checked here or they are not checked at all.
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
    return issueList(dareDomainIssue("event_type", value.eventType));
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
