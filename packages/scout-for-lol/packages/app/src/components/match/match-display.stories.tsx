import { DiscordGuildIdSchema, type MatchLoadout } from "@scout-for-lol/data";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  MatchScoreboards,
  RolePairedMatchScoreboard,
  type RoleMatchup,
} from "./match-scoreboard.tsx";
import { MatchObjectivesSummary } from "./match-objectives-summary.tsx";
import { ChampionIcon } from "./champion-icon.tsx";
import { MatchLoadoutDisplay } from "./match-loadout.tsx";
import {
  ChampionComparisonTable,
  type ChampionComparisonRow,
} from "./champion-comparison-table.tsx";

const SCOUT_TEST_GUILD = DiscordGuildIdSchema.parse("469558207670419456");
const WEEKLY_FLEX_GUILD = DiscordGuildIdSchema.parse("1069813984308248657");

/** Stories have no backend, so every handler is deliberately inert. */
function noop(): void {
  // Intentionally empty.
}

type Teams = Parameters<typeof MatchScoreboards>[0]["teams"];

const BLUE_SIDE: Teams[number] = {
  teamId: 100,
  win: true,
  objectives: { turrets: 9, inhibitors: 2, barons: 1, dragons: 3 },
  participants: [
    {
      participantId: 1,
      teamId: 100,
      selectedPlayer: true,
      riotId: { gameName: "Bald Bard", tagLine: "NA1" },
      championId: 266,
      championName: "Aatrox",
      position: "TOP",
      win: true,
      kills: 7,
      deaths: 2,
      assists: 6,
      creepScore: 231,
      goldEarned: 14_820,
      visionScore: 21,
      damageToChampions: 24_310,
      killParticipation: 0.52,
      damageShare: 0.28,
      objectives: { turrets: 3, inhibitors: 1, barons: 0, dragons: 0 },
      scoutAliases: [
        { playerId: 42, alias: "bald", guildName: "Scout Test Server" },
      ],
    },
    {
      participantId: 2,
      teamId: 100,
      riotId: { gameName: "Jungle Diff", tagLine: "EUW" },
      championId: 64,
      championName: "LeeSin",
      position: "JUNGLE",
      win: true,
      kills: 4,
      deaths: 5,
      assists: 14,
      creepScore: 164,
      goldEarned: 12_140,
      visionScore: 36,
      damageToChampions: 15_902,
      killParticipation: 0.69,
      damageShare: 0.18,
      objectives: { turrets: 1, inhibitors: 0, barons: 1, dragons: 3 },
    },
    {
      participantId: 3,
      teamId: 100,
      riotId: { gameName: "Nine Tails", tagLine: "KR1" },
      championId: 103,
      championName: "Ahri",
      position: "MIDDLE",
      win: true,
      kills: 11,
      deaths: 3,
      assists: 8,
      creepScore: 254,
      goldEarned: 16_390,
      visionScore: 24,
      damageToChampions: 31_744,
      killParticipation: 0.73,
      damageShare: 0.36,
      objectives: { turrets: 2, inhibitors: 1, barons: 0, dragons: 0 },
    },
    {
      participantId: 4,
      teamId: 100,
      riotId: { gameName: "Powder", tagLine: "NA1" },
      championId: 222,
      championName: "Jinx",
      position: "BOTTOM",
      win: true,
      kills: 9,
      deaths: 4,
      assists: 7,
      creepScore: 287,
      goldEarned: 17_050,
      visionScore: 18,
      damageToChampions: 28_611,
      killParticipation: 0.51,
      damageShare: 0.33,
      objectives: { turrets: 3, inhibitors: 0, barons: 0, dragons: 0 },
    },
    {
      participantId: 5,
      teamId: 100,
      riotId: { gameName: "Chain Warden", tagLine: "OCE" },
      championId: 412,
      championName: "Thresh",
      position: "UTILITY",
      win: true,
      kills: 1,
      deaths: 6,
      assists: 22,
      creepScore: 31,
      goldEarned: 9460,
      visionScore: 71,
      damageToChampions: 7120,
      killParticipation: 0.71,
      damageShare: 0.08,
      objectives: { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 },
    },
  ],
};

const RED_SIDE: Teams[number] = {
  teamId: 200,
  win: false,
  objectives: { turrets: 2, inhibitors: 0, barons: 0, dragons: 1 },
  participants: [
    {
      participantId: 6,
      teamId: 200,
      riotId: { gameName: "Wukong Main", tagLine: "NA1" },
      championId: 62,
      championName: "MonkeyKing",
      position: "TOP",
      win: false,
      kills: 3,
      deaths: 8,
      assists: 4,
      creepScore: 198,
      goldEarned: 10_940,
      visionScore: 17,
      damageToChampions: 16_204,
      killParticipation: 0.41,
      damageShare: 0.22,
      objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
    },
    {
      participantId: 7,
      teamId: 200,
      riotId: { gameName: "Kindred Spirit", tagLine: "EUNE" },
      championId: 203,
      championName: "Kindred",
      position: "JUNGLE",
      win: false,
      kills: 5,
      deaths: 7,
      assists: 3,
      creepScore: 172,
      goldEarned: 11_305,
      visionScore: 29,
      damageToChampions: 14_580,
      killParticipation: 0.47,
      damageShare: 0.2,
      objectives: { turrets: 0, inhibitors: 0, barons: 0, dragons: 1 },
    },
    {
      participantId: 8,
      teamId: 200,
      riotId: { gameName: "Card Master", tagLine: "BR1" },
      championId: 4,
      championName: "TwistedFate",
      position: "MIDDLE",
      win: false,
      kills: 4,
      deaths: 6,
      assists: 6,
      creepScore: 221,
      goldEarned: 12_010,
      visionScore: 22,
      damageToChampions: 18_970,
      killParticipation: 0.59,
      damageShare: 0.26,
      objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
    },
    {
      participantId: 9,
      teamId: 200,
      riotId: { gameName: "Rapid Fire", tagLine: "NA1" },
      championId: 22,
      championName: "Ashe",
      position: "BOTTOM",
      win: false,
      kills: 3,
      deaths: 9,
      assists: 5,
      creepScore: 243,
      goldEarned: 11_780,
      visionScore: 19,
      damageToChampions: 15_340,
      killParticipation: 0.47,
      damageShare: 0.21,
      objectives: { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 },
    },
    {
      participantId: 10,
      teamId: 200,
      riotId: { gameName: null, tagLine: null },
      championId: 117,
      championName: "Lulu",
      position: "",
      win: false,
      kills: 2,
      deaths: 10,
      assists: 9,
      creepScore: 27,
      goldEarned: 8115,
      visionScore: 63,
      damageToChampions: 5240,
      killParticipation: null,
      damageShare: null,
      objectives: { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 },
    },
  ],
};

const SAMPLE_LOADOUT: MatchLoadout = {
  itemIds: [1055, 3006, 3031, 3094, 3072, 0, 3340],
  summonerSpellIds: [4, 7],
  runes: {
    primaryStyleId: 8000,
    primaryRuneIds: [8005, 8009, 9103, 8014],
    secondaryStyleId: 8300,
    secondaryRuneIds: [8304, 8347],
    statShardIds: { offense: 5005, flex: 5008, defense: 5002 },
  },
};

const ROLE_PAIRED_TEAMS = [BLUE_SIDE, RED_SIDE].map((team) => ({
  ...team,
  participants: team.participants.map((participant) => ({
    ...participant,
    loadout: SAMPLE_LOADOUT,
  })),
}));

const ROLE_MATCHUPS: RoleMatchup[] = [
  {
    role: "top",
    blueParticipantId: 1,
    redParticipantId: 6,
    at15: {
      timestampMs: 900_000,
      goldDelta: 1250,
      creepScoreDelta: 18,
      xpDelta: 640,
    },
  },
  {
    role: "jungle",
    blueParticipantId: 2,
    redParticipantId: 7,
    at15: {
      timestampMs: 900_000,
      goldDelta: -420,
      creepScoreDelta: -6,
      xpDelta: -210,
    },
  },
  {
    role: "middle",
    blueParticipantId: 3,
    redParticipantId: 8,
    at15: {
      timestampMs: 900_000,
      goldDelta: 760,
      creepScoreDelta: 9,
      xpDelta: 380,
    },
  },
  {
    role: "adc",
    blueParticipantId: 4,
    redParticipantId: 9,
    at15: {
      timestampMs: 900_000,
      goldDelta: 210,
      creepScoreDelta: -3,
      xpDelta: 155,
    },
  },
  {
    role: "support",
    blueParticipantId: 5,
    redParticipantId: 10,
    at15: {
      timestampMs: 900_000,
      goldDelta: -110,
      creepScoreDelta: 2,
      xpDelta: -85,
    },
  },
];

const COMPARISON_ROWS: ChampionComparisonRow[] = [
  {
    playerId: 42,
    alias: "bald",
    guild: { guildId: SCOUT_TEST_GUILD, name: "Scout Test Server" },
    viewerLinked: true,
    games: 24,
    wins: 15,
    losses: 9,
    winRate: 0.625,
    kda: 3.41,
    csPerMinute: 7.8,
    damagePerMinute: 812,
    goldPerMinute: 419,
    visionPerMinute: 0.9,
  },
  {
    playerId: 43,
    alias: "vaughn",
    guild: { guildId: SCOUT_TEST_GUILD, name: "Scout Test Server" },
    viewerLinked: false,
    games: 11,
    wins: 4,
    losses: 7,
    winRate: 0.3636,
    kda: 2.06,
    csPerMinute: 6.2,
    damagePerMinute: 644,
    goldPerMinute: 371,
    visionPerMinute: 1.4,
  },
  {
    playerId: 44,
    alias: "tris",
    guild: { guildId: WEEKLY_FLEX_GUILD, name: "Weekly Flex" },
    viewerLinked: false,
    games: 6,
    wins: 5,
    losses: 1,
    winRate: 0.8333,
    kda: 4.9,
    csPerMinute: 8.4,
    damagePerMinute: 935,
    goldPerMinute: 462,
    visionPerMinute: 0.7,
  },
];

const meta = {
  title: "Match/Display",
  component: MatchScoreboards,
  tags: ["autodocs"],
} satisfies Meta<typeof MatchScoreboards>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Scoreboards: Story = {
  args: { teams: [BLUE_SIDE, RED_SIDE] },
};

export const RotatingAugments: Story = {
  args: {
    teams: [
      {
        ...BLUE_SIDE,
        participants: BLUE_SIDE.participants.map((participant, index) =>
          index === 0
            ? {
                ...participant,
                augments: [
                  { id: 4001, name: "Giant Slayer" },
                  { id: 4002, name: "Jeweled Gauntlet" },
                ],
              }
            : participant,
        ),
      },
    ],
    showLoadout: true,
  },
};

export const RolePaired: Story = {
  args: { teams: [BLUE_SIDE, RED_SIDE] },
  render: () => (
    <RolePairedMatchScoreboard
      teams={ROLE_PAIRED_TEAMS}
      matchups={ROLE_MATCHUPS}
    />
  ),
};

export const HistoricalRuneLoadout: Story = {
  args: { teams: [] },
  render: () => (
    <MatchLoadoutDisplay
      loadout={{
        ...SAMPLE_LOADOUT,
        runes: {
          primaryStyleId: 8000,
          primaryRuneIds: [8005, 8009, 9103, 8014],
          secondaryStyleId: 8100,
          secondaryRuneIds: [8138, 8135],
          statShardIds: { offense: 5005, flex: 5008, defense: 5002 },
        },
      }}
    />
  ),
};

export const SingleTeam: Story = {
  args: { teams: [BLUE_SIDE] },
};

export const ObjectivesSummary: Story = {
  args: { teams: [] },
  render: () => (
    <ul className="space-y-2 text-sm text-scout-subtle">
      <li>
        <span className="font-display text-scout-ink">Team 100 · </span>
        <MatchObjectivesSummary objectives={BLUE_SIDE.objectives} />
      </li>
      <li>
        <span className="font-display text-scout-ink">Team 200 · </span>
        <MatchObjectivesSummary objectives={RED_SIDE.objectives} />
      </li>
      <li>
        <span className="font-display text-scout-ink">
          Surrendered at 15 ·{" "}
        </span>
        <MatchObjectivesSummary
          objectives={{ turrets: 0, inhibitors: 0, barons: 0, dragons: 0 }}
        />
      </li>
    </ul>
  ),
};

export const ChampionIcons: Story = {
  args: { teams: [] },
  render: () => (
    <div className="flex items-center gap-3">
      <ChampionIcon championName="Ahri" />
      <ChampionIcon championName="MonkeyKing" size="md" />
      <ChampionIcon championName="Thresh" size="md" />
      <ChampionIcon
        championName="Jinx"
        size="md"
        decorative
        className="rounded-full"
      />
    </div>
  ),
};

export const ComparisonTable: Story = {
  args: { teams: [] },
  render: () => (
    <ChampionComparisonTable
      rows={COMPARISON_ROWS}
      profileSearch="?champion=Ahri"
      page={0}
      hasNextPage
      pending={false}
      empty="No tracked player has played this champion yet."
      onPrevious={noop}
      onNext={noop}
    />
  ),
};

export const ComparisonTableEmpty: Story = {
  args: { teams: [] },
  render: () => (
    <ChampionComparisonTable
      rows={[]}
      profileSearch=""
      page={0}
      hasNextPage={false}
      pending={false}
      empty="No tracked player has played this champion yet."
      onPrevious={noop}
      onNext={noop}
    />
  ),
};
