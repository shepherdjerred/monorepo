import {
  ExploreLoadoutCardSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
  getItemInfo,
  getRuneTreeInfo,
  listRunes,
  summoner,
  type ExploreLoadoutCard,
  type ExploreLoadoutCardRequest,
  type ReportAiPreviewSummary,
} from "@scout-for-lol/data";
import type { ScoutQlSource } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import {
  fetchTimelineCoverage,
  fetchTimelineEventPage,
  type TimelineEventRead,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import {
  fetchMatchLoadoutRows,
  type LakeMatchLoadoutRow,
} from "#src/reports/duckdb/consumer-match-loadout-lake-reads.ts";

const runeById = new Map(listRunes().map((rune) => [rune.id, rune]));
const spellByNumericId = new Map(
  Object.values(summoner.data).map((spell) => [Number(spell.key), spell]),
);

export type ExploreLoadoutPair = {
  matchId: string;
  puuid: string;
};

export function exploreLoadoutPairKey(pair: ExploreLoadoutPair): string {
  return JSON.stringify([pair.matchId, pair.puuid]);
}

/** The model may request a card only for an exact participant row it queried. */
export function loadoutPairsInPreview(
  preview: ReportAiPreviewSummary | null,
  source: ScoutQlSource | null,
): Set<string> {
  if (preview === null || source !== "match_participants") return new Set();
  const columns = new Set(preview.columns.map((column) => column.key));
  if (!columns.has("match_id") || !columns.has("puuid")) return new Set();

  const pairs = new Set<string>();
  for (const row of preview.rows) {
    const matchIdValue = row.values.find(
      (value) => value.column === "match_id",
    )?.value;
    const puuidValue = row.values.find(
      (value) => value.column === "puuid",
    )?.value;
    if (typeof matchIdValue !== "string" || typeof puuidValue !== "string") {
      continue;
    }
    const matchId = MatchIdSchema.safeParse(matchIdValue);
    const puuid = LeaguePuuidSchema.safeParse(puuidValue);
    if (matchId.success && puuid.success) {
      pairs.add(
        exploreLoadoutPairKey({ matchId: matchId.data, puuid: puuid.data }),
      );
    }
  }
  return pairs;
}

export function assertEligibleExploreLoadoutCardRequests(input: {
  requests: ExploreLoadoutCardRequest[];
  eligiblePairs: Set<string>;
}): void {
  for (const request of input.requests) {
    if (
      !input.eligiblePairs.has(
        exploreLoadoutPairKey({
          matchId: request.matchId,
          puuid: request.puuid,
        }),
      )
    ) {
      throw new Error(
        `Explore loadout card ${request.matchId} was not returned for that participant by the latest query`,
      );
    }
  }
}

function itemName(itemId: number | null): string | null {
  return itemId === null || itemId <= 0
    ? null
    : (getItemInfo(itemId)?.name ?? null);
}

function namedRune(runeId: number | null) {
  if (runeId === null || runeId <= 0) return null;
  const rune = runeById.get(runeId);
  const iconName = rune?.icon
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "");
  return {
    id: runeId,
    assetKey: iconName ?? rune?.key ?? String(runeId),
    name: rune?.name ?? `Rune ${runeId.toString()}`,
  };
}

function namedTree(treeId: number | null) {
  if (treeId === null || treeId <= 0) return null;
  const tree = getRuneTreeInfo(treeId);
  const iconName = tree?.icon
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "");
  return {
    id: treeId,
    assetKey: iconName ?? String(treeId),
    name: tree?.name ?? `Rune tree ${treeId.toString()}`,
  };
}

function namedSpell(spellId: number | null) {
  if (spellId === null || spellId <= 0) {
    return { spellId: null, name: null };
  }
  const spell = spellByNumericId.get(spellId);
  return {
    spellId: spell?.id ?? String(spellId),
    name: spell?.name ?? `Spell ${spellId.toString()}`,
  };
}

const SKILL_BY_SLOT: Readonly<Record<number, "Q" | "W" | "E" | "R">> = {
  1: "Q",
  2: "W",
  3: "E",
  4: "R",
};

const TIMELINE_EVENT_TYPES = [
  "ITEM_PURCHASED",
  "ITEM_UNDO",
  "ITEM_SOLD",
  "SKILL_LEVEL_UP",
];
const TIMELINE_EVENT_LIMIT = 5000;

type LoadoutTimelineEvent = Pick<
  TimelineEventRead,
  | "event_id"
  | "event_timestamp_ms"
  | "frame_index"
  | "event_index"
  | "event_type"
  | "before_id"
  | "item_id"
  | "skill_slot"
  | "level"
>;

export function buildPathFromEvents(events: readonly LoadoutTimelineEvent[]) {
  const path: {
    minute: number;
    itemId: number;
    name: string | null;
    kind: "purchase" | "sold";
  }[] = [];
  const ordered = [...events].toSorted(
    (left, right) =>
      left.event_timestamp_ms - right.event_timestamp_ms ||
      left.frame_index - right.frame_index ||
      left.event_index - right.event_index ||
      left.event_id.localeCompare(right.event_id),
  );

  for (const event of ordered) {
    if (event.event_type === "ITEM_UNDO") {
      const itemId = event.before_id ?? event.item_id;
      if (itemId === null) continue;
      const undoneIndex = path.findLastIndex(
        (entry) => entry.kind === "purchase" && entry.itemId === itemId,
      );
      if (undoneIndex !== -1) path.splice(undoneIndex, 1);
      continue;
    }
    if (
      (event.event_type !== "ITEM_PURCHASED" &&
        event.event_type !== "ITEM_SOLD") ||
      event.item_id === null ||
      event.item_id <= 0
    ) {
      continue;
    }
    path.push({
      minute: Math.floor(event.event_timestamp_ms / 60_000),
      itemId: event.item_id,
      name: itemName(event.item_id),
      kind: event.event_type === "ITEM_SOLD" ? "sold" : "purchase",
    });
  }
  return path;
}

export function skillOrderFromEvents(events: readonly LoadoutTimelineEvent[]) {
  const skillEvents = events
    .filter(
      (event) =>
        event.event_type === "SKILL_LEVEL_UP" &&
        event.skill_slot !== null &&
        SKILL_BY_SLOT[event.skill_slot] !== undefined,
    )
    .toSorted(
      (left, right) =>
        left.event_timestamp_ms - right.event_timestamp_ms ||
        left.frame_index - right.frame_index ||
        left.event_index - right.event_index ||
        left.event_id.localeCompare(right.event_id),
    );
  return skillEvents.flatMap((event, index) => {
    const skill =
      event.skill_slot === null ? undefined : SKILL_BY_SLOT[event.skill_slot];
    const level = event.level ?? index + 1;
    return skill === undefined || level < 1 || level > 18
      ? []
      : [{ level, skill }];
  });
}

function finalItems(row: LakeMatchLoadoutRow) {
  const ids = [
    row.item0,
    row.item1,
    row.item2,
    row.item3,
    row.item4,
    row.item5,
    row.item6,
  ];
  return ids.map((itemId, slot) => ({
    slot,
    itemId: itemId !== null && itemId > 0 ? itemId : null,
    name: itemName(itemId),
  }));
}

function runePage(row: LakeMatchLoadoutRow) {
  return {
    primaryTree: namedTree(row.perk_primary_style),
    keystone: namedRune(row.perk0),
    primaryRunes: [row.perk1, row.perk2, row.perk3]
      .map((runeId) => namedRune(runeId))
      .filter((rune) => rune !== null),
    secondaryTree: namedTree(row.perk_sub_style),
    secondaryRunes: [row.perk4, row.perk5]
      .map((runeId) => namedRune(runeId))
      .filter((rune) => rune !== null),
    shards: [
      { slot: "offense" as const, id: row.stat_perk_offense },
      { slot: "flex" as const, id: row.stat_perk_flex },
      { slot: "defense" as const, id: row.stat_perk_defense },
    ],
  };
}

async function timelineForParticipant(
  matchId: string,
  participantId: number,
): Promise<TimelineEventRead[] | null> {
  const coverage = await fetchTimelineCoverage({ matchId });
  if (coverage === null) return null;
  return await fetchTimelineEventPage({
    matchId,
    offset: 0,
    limit: TIMELINE_EVENT_LIMIT,
    eventTypes: TIMELINE_EVENT_TYPES,
    participantIds: [participantId],
  }).then((events) =>
    events.filter((event) => event.participant_id === participantId),
  );
}

export function buildExploreLoadoutCard(input: {
  request: ExploreLoadoutCardRequest;
  row: LakeMatchLoadoutRow;
  timelineEvents: TimelineEventRead[] | null;
}): ExploreLoadoutCard {
  const { request, row, timelineEvents } = input;
  if (row.match_id !== request.matchId || row.puuid !== request.puuid) {
    throw new Error("Loadout card participant does not match its request");
  }
  const card = ExploreLoadoutCardSchema.parse({
    size: request.size,
    matchId: row.match_id,
    participantId: row.participant_id,
    championId: row.champion_id,
    championName: row.champion_name,
    gameDurationSeconds: row.game_duration_seconds,
    finalItems: finalItems(row),
    spells: [
      { slot: 1, ...namedSpell(row.summoner1_id) },
      { slot: 2, ...namedSpell(row.summoner2_id) },
    ],
    runePage: runePage(row),
    buildPathRecorded: timelineEvents !== null,
    buildPath:
      timelineEvents === null ? [] : buildPathFromEvents(timelineEvents),
    skillOrder:
      timelineEvents === null ? [] : skillOrderFromEvents(timelineEvents),
  });
  return card;
}

async function hydrateOne(
  request: ExploreLoadoutCardRequest,
): Promise<ExploreLoadoutCard> {
  const rows = await fetchMatchLoadoutRows({ matchId: request.matchId });
  const row = rows.find(
    (candidate) =>
      candidate.match_id === request.matchId &&
      candidate.puuid === request.puuid,
  );
  if (row === undefined) {
    throw new Error(
      `Queried participant ${request.puuid} is missing from match ${request.matchId}`,
    );
  }
  const timelineEvents = await timelineForParticipant(
    request.matchId,
    row.participant_id,
  );
  return buildExploreLoadoutCard({ request, row, timelineEvents });
}

export async function hydrateExploreLoadoutCards(input: {
  requests: ExploreLoadoutCardRequest[];
  eligiblePairs: Set<string>;
}): Promise<ExploreLoadoutCard[]> {
  assertEligibleExploreLoadoutCardRequests(input);
  return await Promise.all(
    input.requests.map((request) => hydrateOne(request)),
  );
}
