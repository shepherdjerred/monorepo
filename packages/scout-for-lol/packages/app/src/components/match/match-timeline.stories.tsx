import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MatchTimeline } from "./match-timeline.tsx";
import { TimelineFrameTable } from "./timeline-frame-table.tsx";
import { TimelinePagination } from "./timeline-pagination.tsx";
import { ChampionCombobox } from "./champion-combobox.tsx";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";

/** Stories have no backend, so every handler is deliberately inert. */
function noop(): void {
  // Intentionally empty.
}

type Coverage =
  RouterOutputs["consumerMatch"]["detail"]["timeline"]["coverage"];
type TimelineEvent = RouterOutputs["consumerMatch"]["events"]["rows"][number];
type TimelineFrame = RouterOutputs["consumerMatch"]["frames"]["rows"][number];
type ChartPoint =
  RouterOutputs["consumerMatch"]["chartSeries"]["points"][number];

const PLAYER_ID = 42;
const MATCH_ID = "NA1_4912837465";

const COVERAGE: Coverage = {
  coverage_state: "complete",
  data_version: "2",
  frame_interval_ms: 60_000,
  frame_count: 340,
  event_count: 1284,
  participant_count: 10,
  first_frame_timestamp_ms: 0,
  last_frame_timestamp_ms: 2_040_000,
};

function emptyEvent(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    event_id: "placeholder",
    frame_index: 0,
    event_index: 0,
    frame_timestamp_ms: 0,
    event_timestamp_ms: 0,
    event_type: "GAME_END",
    participant_id: null,
    killer_id: null,
    victim_id: null,
    creator_id: null,
    team_id: null,
    killer_team_id: null,
    item_id: null,
    after_id: null,
    before_id: null,
    skill_slot: null,
    level: null,
    bounty: null,
    shutdown_bounty: null,
    kill_streak_length: null,
    gold_gain: null,
    position_x: null,
    position_y: null,
    ward_type: null,
    building_type: null,
    lane_type: null,
    tower_type: null,
    monster_type: null,
    monster_sub_type: null,
    level_up_type: null,
    winning_team_id: null,
    real_timestamp_ms: null,
    ...overrides,
  };
}

const KEY_EVENTS: TimelineEvent[] = [
  emptyEvent({
    event_id: "evt-first-blood",
    frame_index: 4,
    event_index: 11,
    frame_timestamp_ms: 240_000,
    event_timestamp_ms: 253_118,
    event_type: "CHAMPION_KILL",
    killer_id: 3,
    victim_id: 8,
    killer_team_id: 100,
    bounty: 400,
    position_x: 7412,
    position_y: 7980,
  }),
  emptyEvent({
    event_id: "evt-infernal",
    frame_index: 9,
    event_index: 2,
    frame_timestamp_ms: 540_000,
    event_timestamp_ms: 548_902,
    event_type: "ELITE_MONSTER_KILL",
    killer_id: 2,
    killer_team_id: 100,
    monster_type: "DRAGON",
    monster_sub_type: "FIRE_DRAGON",
  }),
  emptyEvent({
    event_id: "evt-first-tower",
    frame_index: 12,
    event_index: 7,
    frame_timestamp_ms: 720_000,
    event_timestamp_ms: 731_455,
    event_type: "BUILDING_KILL",
    killer_id: 4,
    team_id: 200,
    building_type: "TOWER_BUILDING",
    tower_type: "OUTER_TURRET",
    lane_type: "BOT_LANE",
  }),
  emptyEvent({
    event_id: "evt-baron",
    frame_index: 27,
    event_index: 3,
    frame_timestamp_ms: 1_620_000,
    event_timestamp_ms: 1_631_044,
    event_type: "ELITE_MONSTER_KILL",
    killer_id: 2,
    killer_team_id: 100,
    monster_type: "BARON_NASHOR",
  }),
  emptyEvent({
    event_id: "evt-game-end",
    frame_index: 34,
    event_index: 0,
    frame_timestamp_ms: 2_040_000,
    event_timestamp_ms: 2_041_918,
    event_type: "GAME_END",
    winning_team_id: 100,
    real_timestamp_ms: 1_735_689_600_000,
  }),
];

function frame(row: {
  frameIndex: number;
  participantId: number;
  puuid: string;
  gold: number;
  xp: number;
}): TimelineFrame {
  const { frameIndex, gold } = row;
  return {
    frame_index: frameIndex,
    frame_timestamp_ms: frameIndex * 60_000,
    participant_id: row.participantId,
    puuid: row.puuid,
    position_x: 5120 + frameIndex * 180,
    position_y: 6480 - frameIndex * 120,
    current_gold: Math.round(gold * 0.14),
    total_gold: gold,
    gold_per_second: 20,
    minions_killed: frameIndex * 8,
    jungle_minions_killed: frameIndex,
    level: Math.min(18, 1 + frameIndex),
    xp: row.xp,
    time_enemy_spent_controlled: frameIndex * 120,
    ability_haste: 15,
    ability_power: 0,
    armor: 48 + frameIndex * 3,
    attack_damage: 74 + frameIndex * 6,
    attack_speed: 112,
    health: 1180 + frameIndex * 90,
    health_max: 1240 + frameIndex * 90,
    magic_resist: 32 + frameIndex * 2,
    movement_speed: 345,
    power: 310,
    power_max: 340,
    total_damage_done: frameIndex * 4200,
    total_damage_done_to_champions: frameIndex * 1150,
    total_damage_taken: frameIndex * 980,
  };
}

// Readable stand-ins rather than random-looking Riot PUUIDs: the frame table
// prints the column verbatim and nothing here parses it.
const PUUID_ONE = "story-puuid-blue-top-aatrox";
const PUUID_TWO = "story-puuid-red-top-wukong";

const FRAMES: TimelineFrame[] = [
  frame({
    frameIndex: 1,
    participantId: 1,
    puuid: PUUID_ONE,
    gold: 1140,
    xp: 980,
  }),
  frame({
    frameIndex: 2,
    participantId: 1,
    puuid: PUUID_ONE,
    gold: 2310,
    xp: 2470,
  }),
  frame({
    frameIndex: 3,
    participantId: 1,
    puuid: PUUID_ONE,
    gold: 3690,
    xp: 4180,
  }),
  frame({
    frameIndex: 1,
    participantId: 6,
    puuid: PUUID_TWO,
    gold: 1020,
    xp: 910,
  }),
  frame({
    frameIndex: 2,
    participantId: 6,
    puuid: PUUID_TWO,
    gold: 2050,
    xp: 2180,
  }),
  frame({
    frameIndex: 3,
    participantId: 6,
    puuid: PUUID_TWO,
    gold: 3120,
    xp: 3640,
  }),
];

const CHART_POINTS: ChartPoint[] = [0, 5, 10, 15, 20, 25, 30, 34].map(
  (minute) => ({
    timestampMs: minute * 60_000,
    teamGold: [
      { teamId: 100, gold: 2500 + minute * 1900 },
      { teamId: 200, gold: 2500 + minute * 1620 },
    ],
    selectedGold: 500 + minute * 410,
    selectedXp: 140 + minute * 620,
  }),
);

const seedTimeline: StorySeed = (trpc, queryClient) => {
  const input = { playerId: PLAYER_ID, matchId: MATCH_ID };
  queryClient.setQueryData(
    trpc.consumerMatch.events.queryOptions(input).queryKey,
    {
      nextCursor: { offset: 100 },
      rows: KEY_EVENTS,
    },
  );
  queryClient.setQueryData(
    trpc.consumerMatch.frames.queryOptions(input).queryKey,
    {
      nextCursor: null,
      rows: FRAMES,
    },
  );
  queryClient.setQueryData(
    trpc.consumerMatch.chartSeries.queryOptions(input).queryKey,
    { points: CHART_POINTS },
  );
};

function ChampionComboboxExample() {
  const [championId, setChampionId] = useState("103");
  return (
    <div className="max-w-sm space-y-2">
      <label className="text-sm font-medium" htmlFor="story-champion">
        Champion
      </label>
      <ChampionCombobox
        id="story-champion"
        name="championId"
        gameVariant="MODERN"
        value={championId}
        onChange={setChampionId}
      />
      <p className="text-xs text-scout-subtle">
        Selected champion id: {championId === "" ? "none" : championId}
      </p>
    </div>
  );
}

const meta = {
  title: "Match/Timeline",
  component: MatchTimeline,
  tags: ["autodocs"],
} satisfies Meta<typeof MatchTimeline>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Retained: Story = {
  args: {
    source: { kind: "consumer", playerId: PLAYER_ID },
    matchId: MATCH_ID,
    coverage: COVERAGE,
    keyEvents: KEY_EVENTS,
    participantIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  parameters: { seedQueries: [seedTimeline] },
};

export const NotCaptured: Story = {
  args: {
    source: { kind: "consumer", playerId: PLAYER_ID },
    matchId: MATCH_ID,
    coverage: null,
    keyEvents: [],
    participantIds: [],
  },
};

export const Loading: Story = {
  args: {
    source: { kind: "consumer", playerId: PLAYER_ID },
    matchId: MATCH_ID,
    coverage: COVERAGE,
    keyEvents: [],
    participantIds: [1, 2, 3, 4, 5],
  },
};

export const FrameTable: Story = {
  args: {
    source: { kind: "explore" },
    matchId: MATCH_ID,
    coverage: null,
    keyEvents: [],
    participantIds: [],
  },
  render: () => (
    <TimelineFrameTable
      rows={FRAMES}
      error={false}
      pending={false}
      page={0}
      nextCursor={{ offset: 100 }}
      onPrevious={noop}
      onNext={noop}
    />
  ),
};

export const FrameTableError: Story = {
  args: {
    source: { kind: "explore" },
    matchId: MATCH_ID,
    coverage: null,
    keyEvents: [],
    participantIds: [],
  },
  render: () => (
    <TimelineFrameTable
      rows={[]}
      error
      pending={false}
      page={0}
      nextCursor={null}
      onPrevious={noop}
      onNext={noop}
    />
  ),
};

export const Pagination: Story = {
  args: {
    source: { kind: "explore" },
    matchId: MATCH_ID,
    coverage: null,
    keyEvents: [],
    participantIds: [],
  },
  render: () => (
    <div className="space-y-6">
      <TimelinePagination
        page={0}
        pending={false}
        nextCursor={{ offset: 100 }}
        onPrevious={noop}
        onNext={noop}
      />
      <TimelinePagination
        page={3}
        pending={false}
        nextCursor={null}
        onPrevious={noop}
        onNext={noop}
      />
      <TimelinePagination
        page={2}
        pending
        nextCursor={{ offset: 300 }}
        onPrevious={noop}
        onNext={noop}
      />
    </div>
  ),
};

export const ChampionPicker: Story = {
  args: {
    source: { kind: "explore" },
    matchId: MATCH_ID,
    coverage: null,
    keyEvents: [],
    participantIds: [],
  },
  render: () => <ChampionComboboxExample />,
};
