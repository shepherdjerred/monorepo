import type {
  TimelineEventLakeRow,
  TimelineEventParticipantLakeRow,
} from "@scout-for-lol/data";
import {
  STORY_SEATS,
  STORY_VIEWER_PARTICIPANT_ID,
} from "#src/testing/report-lake/story-match-seats.ts";

/** One timeline event before it has an id, a frame or an event index. */
export type DraftEvent = {
  ts: number;
  fields: Partial<TimelineEventLakeRow> & { event_type: string };
  participants: {
    id: number;
    role: TimelineEventParticipantLakeRow["role"];
  }[];
};

const SKILL_ORDER = [1, 2, 3, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2, 4, 2, 2];
const VIEWER = STORY_VIEWER_PARTICIPANT_ID;

function at(minutes: number, seconds = 0): number {
  return (minutes * 60 + seconds) * 1000;
}

function item(
  type: "ITEM_PURCHASED" | "ITEM_SOLD" | "ITEM_UNDO",
  participantId: number,
  ts: number,
  fields: Partial<TimelineEventLakeRow>,
): DraftEvent {
  return {
    ts,
    fields: { event_type: type, participant_id: participantId, ...fields },
    participants: [],
  };
}

function purchase(
  participantId: number,
  ts: number,
  itemId: number,
): DraftEvent {
  return item("ITEM_PURCHASED", participantId, ts, { item_id: itemId });
}

function kill(
  ts: number,
  killer: number,
  victim: number,
  assists: number[],
): DraftEvent {
  return {
    ts,
    fields: {
      event_type: "CHAMPION_KILL",
      killer_id: killer,
      victim_id: victim,
      killer_team_id: killer <= 5 ? 100 : 200,
    },
    participants: [
      { id: killer, role: "killer" },
      { id: victim, role: "victim" },
      ...assists.map((id) => ({ id, role: "assist" as const })),
    ],
  };
}

type ObjectiveInput = {
  ts: number;
  killer: number;
  assists?: number[];
  type: "ELITE_MONSTER_KILL" | "BUILDING_KILL";
  fields: Partial<TimelineEventLakeRow>;
};

function objective(input: ObjectiveInput): DraftEvent {
  return {
    ts: input.ts,
    fields: {
      event_type: input.type,
      killer_id: input.killer,
      killer_team_id: input.killer <= 5 ? 100 : 200,
      ...input.fields,
    },
    participants: [
      { id: input.killer, role: "killer" },
      ...(input.assists ?? []).map((id) => ({ id, role: "assist" as const })),
    ],
  };
}

/**
 * The viewer's purchases: starter, potion and trinket (not part of a build), a
 * Needlessly Large Rod bought then undone, a Doran's Ring sold late, and the
 * path to Malignance, Shadowflame, Rabadon's and Zhonya's.
 */
function viewerPurchases(): DraftEvent[] {
  return [
    purchase(VIEWER, at(0, 8), 1056),
    purchase(VIEWER, at(0, 9), 2003),
    purchase(VIEWER, at(0, 10), 3340),
    purchase(VIEWER, at(5, 10), 1052),
    purchase(VIEWER, at(6, 40), 3802),
    purchase(VIEWER, at(9, 30), 3118),
    purchase(VIEWER, at(10), 2055),
    purchase(VIEWER, at(11), 1001),
    purchase(VIEWER, at(12, 10), 3020),
    purchase(VIEWER, at(15, 20), 4645),
    purchase(VIEWER, at(18), 1058),
    item("ITEM_UNDO", VIEWER, at(18, 5), { before_id: 1058, after_id: 0 }),
    purchase(VIEWER, at(19, 40), 3089),
    item("ITEM_SOLD", VIEWER, at(21), { item_id: 1056 }),
    purchase(VIEWER, at(24, 10), 3157),
  ];
}

function otherPurchases(): DraftEvent[] {
  return STORY_SEATS.flatMap((seat) =>
    seat.participantId === VIEWER
      ? []
      : [
          purchase(seat.participantId, at(0, 10), 1055),
          purchase(seat.participantId, at(0, 11), 2003),
          purchase(seat.participantId, at(8), 1001),
          purchase(
            seat.participantId,
            at(11, seat.participantId),
            seat.core[0],
          ),
          purchase(
            seat.participantId,
            at(18, seat.participantId),
            seat.core[1],
          ),
          purchase(
            seat.participantId,
            at(24, seat.participantId),
            seat.core[2],
          ),
        ],
  );
}

function skillPoints(): DraftEvent[] {
  return STORY_SEATS.flatMap((seat) =>
    SKILL_ORDER.map((slot, index): DraftEvent => ({
      ts: at(0, 5) + index * 100_000 + seat.participantId * 100,
      fields: {
        event_type: "SKILL_LEVEL_UP",
        participant_id: seat.participantId,
        skill_slot: slot,
        level_up_type: "NORMAL",
      },
      participants: [],
    })),
  );
}

function tower(ts: number, killer: number, lane: string, tier: string) {
  return objective({
    ts,
    killer,
    assists: [],
    type: "BUILDING_KILL",
    fields: {
      team_id: 200,
      building_type: "TOWER_BUILDING",
      lane_type: lane,
      tower_type: tier,
    },
  });
}

function monster(
  ts: number,
  killer: number,
  assists: number[],
  fields: Partial<TimelineEventLakeRow>,
) {
  return objective({ ts, killer, assists, type: "ELITE_MONSTER_KILL", fields });
}

/**
 * First blood at 3:12, a triple kill at 20:23, a five-for-one fight at 24:20
 * that ends in an ace, Baron at 24:40, an inhibitor and the end at 27:55.
 */
function fightsAndObjectives(): DraftEvent[] {
  return [
    kill(at(3, 12), 3, 8, [2]),
    monster(at(7, 5), 2, [4, 5], {
      monster_type: "DRAGON",
      monster_sub_type: "FIRE_DRAGON",
    }),
    kill(at(7, 40), 7, 2, [6]),
    monster(at(9, 50), 2, [1], { monster_type: "RIFTHERALD" }),
    tower(at(11, 2), 4, "BOT_LANE", "OUTER_TURRET"),
    kill(at(12, 15), 9, 5, [10]),
    monster(at(13, 20), 7, [6], {
      monster_type: "DRAGON",
      monster_sub_type: "WATER_DRAGON",
    }),
    kill(at(14, 30), 3, 9, [4]),
    tower(at(16, 40), 1, "TOP_LANE", "OUTER_TURRET"),
    kill(at(20, 10), 4, 6, [3]),
    kill(at(20, 16), 4, 7, [5]),
    kill(at(20, 23), 4, 8, [3, 5]),
    kill(at(24, 20), 4, 9, [3]),
    kill(at(24, 24), 6, 1, [10]),
    kill(at(24, 27), 3, 6, [2]),
    kill(at(24, 30), 2, 7, [3]),
    kill(at(24, 33), 4, 10, [5]),
    kill(at(24, 36), 3, 8, [4]),
    monster(at(24, 40), 3, [2, 4, 5], { monster_type: "BARON_NASHOR" }),
    objective({
      ts: at(26, 10),
      killer: 4,
      assists: [3],
      type: "BUILDING_KILL",
      fields: {
        team_id: 200,
        building_type: "INHIBITOR_BUILDING",
        lane_type: "BOT_LANE",
      },
    }),
    {
      ts: at(27, 55),
      fields: { event_type: "GAME_END", winning_team_id: 100 },
      participants: [],
    },
  ];
}

/** Every event of the story match, oldest first. */
export function storyDraftEvents(): DraftEvent[] {
  return [
    ...viewerPurchases(),
    ...otherPurchases(),
    ...skillPoints(),
    ...fightsAndObjectives(),
  ].toSorted((left, right) => left.ts - right.ts);
}
