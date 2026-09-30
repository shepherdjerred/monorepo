import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Loaded } from "@shepherdjerred/loaded";
import {
  RankSchema,
  ROLE_CATALOG,
  createPermissionSet,
} from "@scout-for-lol/data";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";
import { ChampionPoolTable } from "./champion-pool-table.tsx";
import {
  MatchHistoryList,
  PlayerSummaryCards,
  RankCard,
  RecentFormCard,
} from "./player-profile-sections.tsx";
import {
  CompetitionSection,
  PlayerAccountsTable,
  PlayerSubscriptionsTable,
  Section,
  type PlayerSubscriptionRow,
} from "./player-detail-sections.tsx";
import { CombinedPerformance } from "./player-combined-performance.tsx";
import { PlayerProfileFilterBar } from "./player-profile-filter-bar.tsx";
import { PlayerHeaderActions } from "./player-header-actions.tsx";

const GUILD_ID = "377554990325301252";
const PLAYER_ID = 42;
const PROFILE_SEARCH = "?games=50";

function noop(): void {
  // Story callbacks are deliberately inert.
}

const SOLO_RANK = RankSchema.parse({
  tier: "emerald",
  division: 2,
  lp: 64,
  wins: 118,
  losses: 101,
});

const FLEX_RANK = RankSchema.parse({
  tier: "platinum",
  division: 4,
  lp: 12,
  wins: 31,
  losses: 27,
});

const RECENT_FORM = {
  games: 20,
  wins: 12,
  kills: 148,
  deaths: 112,
  assists: 231,
  averageKillParticipation: 0.58,
};

const CHAMPION_POOL = [
  {
    championId: 64,
    championName: "LeeSin",
    games: 37,
    wins: 21,
    losses: 16,
    winRate: 0.567,
    kda: 3.12,
    averageKills: 6.2,
    averageDeaths: 3.5,
    averageAssists: 7.8,
    averageCs: 195,
    csPerMinute: 6.4,
    damagePerMinute: 620,
    averageDamage: 18_800,
    averageVisionScore: 24.5,
    teamPosition: "JUNGLE",
    lowSample: false,
  },
  {
    championId: 254,
    championName: "Vi",
    games: 22,
    wins: 13,
    losses: 9,
    winRate: 0.591,
    kda: 3.44,
    averageKills: 5.8,
    averageDeaths: 3.1,
    averageAssists: 8.4,
    averageCs: 180,
    csPerMinute: 5.9,
    damagePerMinute: 580,
    averageDamage: 17_200,
    averageVisionScore: 21,
    teamPosition: "JUNGLE",
    lowSample: false,
  },
  {
    championId: 62,
    championName: "MonkeyKing",
    games: 4,
    wins: 3,
    losses: 1,
    winRate: 0.75,
    kda: 4.01,
    averageKills: 7,
    averageDeaths: 2.5,
    averageAssists: 6,
    averageCs: 185,
    csPerMinute: 6.1,
    damagePerMinute: 650,
    averageDamage: 19_400,
    averageVisionScore: 18.2,
    teamPosition: "TOP",
    lowSample: true,
  },
];

const MATCH_ENTRIES = [
  {
    matchId: "NA1_5182736451",
    gameCreationMs: Date.now() - 3_600_000,
    gameDurationSeconds: 1942,
    queue: "Ranked Solo/Duo",
    championName: "LeeSin",
    teamPosition: "JUNGLE",
    win: true,
    kills: 9,
    deaths: 3,
    assists: 14,
    creepScore: 187,
    csPerMinute: 5.8,
    killParticipation: 0.72,
    leaguePointsDelta: 21,
    account: { gameName: "sjerred", tagLine: "NA1", region: "NA" },
  },
  {
    matchId: "NA1_5182719038",
    gameCreationMs: Date.now() - 90_000_000,
    gameDurationSeconds: 2411,
    queue: "Ranked Flex",
    championName: "Vi",
    teamPosition: "JUNGLE",
    win: false,
    kills: 4,
    deaths: 8,
    assists: 11,
    creepScore: 166,
    csPerMinute: 4.1,
    killParticipation: 0.51,
    leaguePointsDelta: -18,
    account: { gameName: "nightblue", tagLine: "EUW", region: "EUW" },
  },
];

const SUBSCRIPTIONS: PlayerSubscriptionRow[] = [
  {
    id: 1,
    channelId: "1102938475610293847",
    creatorDiscordId: "444",
    creatorDiscordUser: { username: "sjerred", displayName: "Jerred" },
    createdTime: "2026-06-01T18:30:00.000Z",
    filters: {
      version: 1,
      filters: [{ type: "queue", queues: ["solo", "flex"] }],
    },
    isMuted: false,
  },
  {
    id: 2,
    channelId: "1102938475610293848",
    creatorDiscordId: "445",
    creatorDiscordUser: null,
    createdTime: "2026-07-14T09:05:00.000Z",
    filters: null,
    isMuted: true,
  },
];

const ACCOUNTS = [
  {
    id: 11,
    alias: "sjerred",
    puuid: "story-puuid-sjerred-na1-000000000000000000000000000000000000000",
    region: "NA",
    riotGameName: "sjerred",
    riotTagLine: "NA1",
    lastMatchTime: "2026-09-12T22:41:00.000Z",
    lastCheckedAt: "2026-09-13T01:02:00.000Z",
  },
  {
    id: 12,
    alias: "sjerred",
    puuid: "story-puuid-sjerred-euw-111111111111111111111111111111111111111",
    region: "EUW",
    riotGameName: null,
    riotTagLine: null,
    lastMatchTime: null,
    lastCheckedAt: "2026-09-13T01:02:00.000Z",
  },
];

const COMPETITION_ROWS = [
  {
    id: 5,
    status: "JOINED",
    invitedBy: "444",
    invitedByUser: { username: "sjerred", displayName: "Jerred" },
    invitedAt: "2026-08-01T12:00:00.000Z",
    joinedAt: "2026-08-01T12:30:00.000Z",
    leftAt: null,
    competition: {
      id: 5,
      title: "September CS/min sprint",
      visibility: "OPEN",
      isCancelled: false,
      status: "ACTIVE",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-30T00:00:00.000Z",
    },
  },
  {
    id: 6,
    status: "INVITED",
    invitedBy: null,
    invitedByUser: null,
    invitedAt: null,
    joinedAt: null,
    leftAt: null,
    competition: {
      id: 6,
      title: "Summer flex ladder",
      visibility: "INVITE_ONLY",
      isCancelled: false,
      status: "ENDED",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-08-31T00:00:00.000Z",
    },
  },
];

const MANAGER_PERMISSIONS = createPermissionSet(
  ROLE_CATALOG.manager.permissions,
);
const VIEWER_PERMISSIONS = createPermissionSet(ROLE_CATALOG.viewer.permissions);

/** `PlayerProfileFilterBar` is controlled, so the story owns the selection. */
function FilterBarHarness() {
  const [filters, setFilters] = useState<PlayerProfileFilters>({
    games: 50,
    queues: ["solo", "flex", "ranked 5s", "clash"],
  });
  return (
    <PlayerProfileFilterBar
      filters={filters}
      onChange={(next) => {
        setFilters(next);
      }}
    />
  );
}

const meta = {
  title: "Player/Profile",
  component: PlayerSummaryCards,
  tags: ["autodocs"],
  parameters: { routerEntries: [`/g/${GUILD_ID}/players/sjerred`] },
} satisfies Meta<typeof PlayerSummaryCards>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SummaryCards: Story = {
  args: {
    ranks: { solo: SOLO_RANK, flex: FLEX_RANK },
    recentForm: RECENT_FORM,
  },
};

export const UnrankedSummary: Story = {
  args: { ranks: {}, recentForm: RECENT_FORM },
  render: (args) => (
    <div className="grid gap-4 md:grid-cols-3">
      <RankCard label="Ranked solo/duo" rank={undefined} />
      <RankCard label="Ranked flex" rank={FLEX_RANK} />
      {args.recentForm === null ? null : (
        <RecentFormCard form={args.recentForm} />
      )}
    </div>
  ),
};

export const ChampionPool: Story = {
  args: { ranks: {}, recentForm: null },
  render: () => (
    <Section title="Champion performance">
      <ChampionPoolTable
        rows={CHAMPION_POOL}
        minGamesForRate={10}
        profileSearch={PROFILE_SEARCH}
      />
    </Section>
  ),
};

export const MatchHistory: Story = {
  args: { ranks: {}, recentForm: null },
  render: () => (
    <MatchHistoryList
      entries={MATCH_ENTRIES}
      playerId={PLAYER_ID}
      profileSearch={PROFILE_SEARCH}
    />
  ),
};

export const DetailTables: Story = {
  args: { ranks: {}, recentForm: null },
  render: () => (
    <div className="space-y-6">
      <Section title="Subscriptions">
        <PlayerSubscriptionsTable
          subscriptions={SUBSCRIPTIONS}
          channels={[
            { id: "1102938475610293847", name: "match-reports" },
            { id: "1102938475610293848", name: "ranked-grind" },
          ]}
          canUpdate
          canCreate
          canDelete
          mutationPending={false}
          onEditFilters={noop}
          onMove={noop}
          onToggleMute={noop}
          onAddChannel={noop}
          onRemove={noop}
        />
      </Section>
      <Section title="Accounts">
        <PlayerAccountsTable
          accounts={ACCOUNTS}
          canEdit
          canTransfer
          canDelete
          deletePending={false}
          onEdit={noop}
          onTransfer={noop}
          onDelete={noop}
        />
      </Section>
      <CompetitionSection
        title="Competitions"
        guildId={GUILD_ID}
        rows={COMPETITION_ROWS}
      />
    </div>
  ),
};

export const CombinedPerformanceLoaded: Story = {
  args: { ranks: {}, recentForm: null },
  render: () => (
    <div className="space-y-4">
      <CombinedPerformance
        filters={{ games: 50, queues: ["solo", "flex"] }}
        onFiltersChange={noop}
        championPool={CHAMPION_POOL}
        minGamesForRate={10}
        ranks={{ solo: SOLO_RANK, flex: FLEX_RANK }}
        recentForm={RECENT_FORM}
        history={Loaded.done(MATCH_ENTRIES)}
        historyFetching={false}
        historyRefetching={false}
        entries={MATCH_ENTRIES}
        nextCursor={{
          gameCreationMs: MATCH_ENTRIES[1]?.gameCreationMs ?? 0,
          matchId: "NA1_5182719038",
        }}
        historyPage={0}
        playerId={PLAYER_ID}
        profileSearch={PROFILE_SEARCH}
        onRetryHistory={noop}
        onPreviousHistory={noop}
        onNextHistory={noop}
      />
    </div>
  ),
};

export const ProfileFilterBar: Story = {
  args: { ranks: {}, recentForm: null },
  render: () => <FilterBarHarness />,
};

export const HeaderActions: Story = {
  args: { ranks: {}, recentForm: null },
  render: () => (
    <div className="space-y-4">
      <PlayerHeaderActions
        guildId={GUILD_ID}
        alias="sjerred"
        playerLoaded
        permissions={MANAGER_PERMISSIONS}
        deletePending={false}
        onRename={noop}
        onMerge={noop}
        onDelete={noop}
      />
      <PlayerHeaderActions
        guildId={GUILD_ID}
        alias="sjerred"
        playerLoaded
        permissions={VIEWER_PERMISSIONS}
        deletePending={false}
        onRename={noop}
        onMerge={noop}
        onDelete={noop}
      />
    </div>
  ),
};
