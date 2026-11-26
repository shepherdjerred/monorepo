import { describe, expect, test } from "vitest";
import type {
  StoryAssist,
  StoryEvent,
  StoryFrame,
} from "#src/reports/duckdb/consumer/match-story-reads.ts";
import {
  buildMoments,
  formatGameTime,
  MAX_STORY_MOMENTS,
  type StoryMoment,
} from "#src/trpc/router/consumer/match-story-moments.ts";
import type { StoryRoster } from "#src/trpc/router/consumer/match-story-fights.ts";

const NAMES = [
  "Mossback",
  "Velour",
  "Northstar",
  "RiverQuartz",
  "TidalWren",
  "Tallowick",
  "Ninefold",
  "Windlass",
  "Petrichor",
  "Anchorage",
];

const roster: StoryRoster = new Map(
  NAMES.map((displayName, index) => [
    index + 1,
    {
      teamId: index < 5 ? 100 : 200,
      championId: 100 + index,
      championName: `Champion${(index + 1).toString()}`,
      displayName,
    },
  ]),
);

const frames: StoryFrame[] = NAMES.flatMap((_, index) =>
  [0, 60_000, 1_200_000].map((ts) => ({
    frame_timestamp_ms: ts,
    participant_id: index + 1,
    total_gold: 500,
    level: ts === 0 ? 1 : 16,
  })),
);

function event(
  id: string,
  ts: number,
  fields: Partial<StoryEvent> & { event_type: string },
): StoryEvent {
  return {
    event_id: id,
    event_timestamp_ms: ts,
    participant_id: null,
    killer_id: null,
    victim_id: null,
    team_id: null,
    killer_team_id: null,
    item_id: null,
    before_id: null,
    after_id: null,
    skill_slot: null,
    level_up_type: null,
    building_type: null,
    lane_type: null,
    tower_type: null,
    monster_type: null,
    monster_sub_type: null,
    winning_team_id: null,
    ...fields,
  };
}

function kill(id: string, ts: number, killer: number, victim: number) {
  return event(id, ts, {
    event_type: "CHAMPION_KILL",
    killer_id: killer,
    victim_id: victim,
    killer_team_id: killer <= 5 ? 100 : 200,
  });
}

const ENDING: StoryEvent[] = [
  event("end", 1_700_000, { event_type: "GAME_END", winning_team_id: 100 }),
];

function moments(
  events: StoryEvent[],
  options: { assists?: StoryAssist[]; winnerTeamId?: number | null } = {},
): StoryMoment[] {
  return buildMoments({
    events,
    assists: options.assists ?? [],
    frames,
    roster,
    winnerTeamId:
      options.winnerTeamId === undefined ? 100 : options.winnerTeamId,
  });
}

describe("formatGameTime", () => {
  test("writes minutes and zero-padded seconds", () => {
    expect(formatGameTime(252_900)).toBe("4:12");
    expect(formatGameTime(1_480_000)).toBe("24:40");
    expect(formatGameTime(5000)).toBe("0:05");
  });
});

describe("buildMoments", () => {
  test("states first blood as a fact with the time and the killer", () => {
    const [first] = moments([
      kill("k1", 252_000, 4, 8),
      kill("k2", 400_000, 9, 2),
    ]);
    expect(first).toMatchObject({
      kind: "first_blood",
      teamId: 100,
      text: "First blood at 4:12 by RiverQuartz",
      players: [
        {
          participantId: 4,
          displayName: "RiverQuartz",
          role: "killer",
          championName: "Champion4",
        },
        { participantId: 8, role: "victim" },
      ],
    });
  });

  test("names objectives by kind and subtype, with the killer and assistants", () => {
    const result = moments(
      [
        event("d", 425_000, {
          event_type: "ELITE_MONSTER_KILL",
          killer_id: 2,
          killer_team_id: 100,
          monster_type: "DRAGON",
          monster_sub_type: "FIRE_DRAGON",
        }),
        event("h", 590_000, {
          event_type: "ELITE_MONSTER_KILL",
          killer_id: 7,
          killer_team_id: 200,
          monster_type: "RIFTHERALD",
        }),
        event("b", 1_480_000, {
          event_type: "ELITE_MONSTER_KILL",
          killer_id: 3,
          killer_team_id: 100,
          monster_type: "BARON_NASHOR",
        }),
        event("t", 662_000, {
          event_type: "BUILDING_KILL",
          killer_id: 4,
          team_id: 200,
          building_type: "TOWER_BUILDING",
          lane_type: "BOT_LANE",
          tower_type: "OUTER_TURRET",
        }),
        event("i", 1_570_000, {
          event_type: "BUILDING_KILL",
          killer_id: 4,
          team_id: 200,
          building_type: "INHIBITOR_BUILDING",
          lane_type: "BOT_LANE",
        }),
      ],
      {
        assists: [
          { event_id: "d", participant_id: 4 },
          { event_id: "d", participant_id: 5 },
        ],
      },
    );
    expect(result.map((moment) => moment.text)).toEqual([
      "Infernal dragon at 7:05 by Velour",
      "Rift Herald at 9:50 by Ninefold",
      "Outer bot tower at 11:02 by RiverQuartz",
      "Baron at 24:40 by Northstar",
      "Bot inhibitor at 26:10 by RiverQuartz",
    ]);
    expect(result.map((moment) => [moment.kind, moment.teamId])).toEqual([
      ["dragon", 100],
      ["herald", 200],
      ["tower", 100],
      ["baron", 100],
      ["inhibitor", 100],
    ]);
    expect(
      result[0]?.players.map((entry) => [entry.displayName, entry.role]),
    ).toEqual([
      ["Velour", "killer"],
      ["RiverQuartz", "assist"],
      ["TidalWren", "assist"],
    ]);
  });

  test("a streak of three kills inside ten-second gaps is a triple kill, and a wider gap is not", () => {
    const triple = moments([
      kill("a", 1_200_000, 4, 6),
      kill("b", 1_207_000, 4, 7),
      kill("c", 1_216_000, 4, 8),
    ]).filter((moment) => moment.kind === "multi_kill");
    expect(triple).toHaveLength(1);
    expect(triple[0]).toMatchObject({
      count: 3,
      text: "Triple kill at 20:16 by RiverQuartz",
    });
    const apart = moments([
      kill("a", 1_200_000, 4, 6),
      kill("b", 1_207_000, 4, 7),
      kill("c", 1_218_000, 4, 8),
    ]).filter((moment) => moment.kind === "multi_kill");
    expect(apart).toEqual([]);
  });

  test("an ace is five deaths on one team before anyone returns", () => {
    const wipe = [6, 7, 8, 9, 10].map((victim, index) =>
      kill(`w${index.toString()}`, 1_200_000 + index * 4000, 3, victim),
    );
    const aces = moments(wipe).filter((moment) => moment.kind === "ace");
    expect(aces).toHaveLength(1);
    expect(aces[0]).toMatchObject({
      teamId: 100,
      timestampMs: 1_216_000,
      text: "Ace at 20:16 by Northstar",
    });
    const spread = [6, 7, 8, 9, 10].map((victim, index) =>
      kill(`s${index.toString()}`, 1_200_000 + index * 40_000, 3, victim),
    );
    expect(moments(spread).filter((moment) => moment.kind === "ace")).toEqual(
      [],
    );
  });

  test("the deciding fight is the last fight the winners took by two or more, followed by an inhibitor or the end", () => {
    const early = [
      kill("e1", 600_000, 3, 6),
      kill("e2", 604_000, 4, 7),
      kill("e3", 608_000, 5, 8),
    ];
    const late = [
      kill("l1", 1_600_000, 3, 6),
      kill("l2", 1_604_000, 4, 7),
      kill("l3", 1_606_000, 8, 1),
      kill("l4", 1_610_000, 5, 9),
    ];
    const result = moments([...early, ...late, ...ENDING]).filter(
      (moment) => moment.kind === "deciding_fight",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      timestampMs: 1_600_000,
      teamId: 100,
      count: 3,
      opposingCount: 1,
      text: "Deciding fight at 26:40, 3 kills to 1",
    });
    expect(result[0]?.players.map((entry) => entry.participantId)).toEqual([
      3, 4, 5,
    ]);
  });

  test("a game with no winner has no deciding fight", () => {
    const fight = [
      kill("l1", 1_600_000, 3, 6),
      kill("l2", 1_604_000, 4, 7),
      kill("l3", 1_606_000, 5, 8),
    ];
    expect(
      moments([...fight, ...ENDING], { winnerTeamId: null }).filter(
        (moment) => moment.kind === "deciding_fight",
      ),
    ).toEqual([]);
  });
});

describe("buildMoments ordering and bounds", () => {
  test("orders the same instant by kind, and does not depend on the order events arrive in", () => {
    const events = [
      kill("k1", 252_000, 4, 8),
      kill("k2", 1_200_000, 4, 6),
      kill("k3", 1_207_000, 4, 7),
      kill("k4", 1_216_000, 4, 8),
      event("t1", 1_216_000, {
        event_type: "BUILDING_KILL",
        killer_id: 4,
        team_id: 200,
        building_type: "TOWER_BUILDING",
        lane_type: "TOP_LANE",
        tower_type: "INNER_TURRET",
      }),
      event("b1", 1_216_000, {
        event_type: "ELITE_MONSTER_KILL",
        killer_id: 3,
        killer_team_id: 100,
        monster_type: "BARON_NASHOR",
      }),
      event("b0", 1_216_000, {
        event_type: "ELITE_MONSTER_KILL",
        killer_id: 2,
        killer_team_id: 100,
        monster_type: "DRAGON",
        monster_sub_type: "AIR_DRAGON",
      }),
      ...ENDING,
    ];
    const baseline = moments(events);
    const sameInstant = baseline
      .filter((moment) => moment.timestampMs === 1_216_000)
      .map((moment) => moment.kind);
    expect(sameInstant).toEqual(["multi_kill", "tower", "dragon", "baron"]);
    expect(moments(events.toReversed())).toEqual(baseline);
    expect(moments([...events.slice(3), ...events.slice(0, 3)])).toEqual(
      baseline,
    );
    expect(
      moments(events.toSorted((a, b) => a.event_id.localeCompare(b.event_id))),
    ).toEqual(baseline);
  });

  test("keeps the most telling facts when a game exceeds the cap", () => {
    const towers = Array.from({ length: MAX_STORY_MOMENTS + 5 }, (_, index) =>
      event(
        `tower${index.toString().padStart(3, "0")}`,
        100_000 + index * 1000,
        {
          event_type: "BUILDING_KILL",
          killer_id: 3,
          team_id: 200,
          building_type: "TOWER_BUILDING",
          lane_type: "MID_LANE",
          tower_type: "OUTER_TURRET",
        },
      ),
    );
    const baron = event("baron", 1_480_000, {
      event_type: "ELITE_MONSTER_KILL",
      killer_id: 3,
      killer_team_id: 100,
      monster_type: "BARON_NASHOR",
    });
    const result = moments([...towers, baron]);
    expect(result).toHaveLength(MAX_STORY_MOMENTS);
    expect(result.some((moment) => moment.kind === "baron")).toBe(true);
    expect(result.map((moment) => moment.timestampMs)).toEqual(
      result.map((moment) => moment.timestampMs).toSorted((a, b) => a - b),
    );
  });

  test("leaves out a kill whose victim is not on the roster", () => {
    expect(moments([kill("ghost", 60_000, 3, 99)])).toEqual([]);
  });
});
