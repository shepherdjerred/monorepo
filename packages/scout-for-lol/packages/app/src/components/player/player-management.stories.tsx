import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Loaded } from "@shepherdjerred/loaded";
import { ROLE_CATALOG, createPermissionSet } from "@scout-for-lol/data";
import { Label } from "@scout-for-lol/design-system/components/forms/field";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import { PlayerAliasCombobox } from "./player-alias-combobox.tsx";
import { PlayerAliasFormField } from "./player-alias-form-field.tsx";
import { PlayerSubscriptionsManager } from "./player-subscriptions-manager.tsx";
import { RecordedMatchHistory } from "./recorded-match-history.tsx";
import type { PlayerSubscriptionRow } from "./player-detail-sections.tsx";

const GUILD_ID = "377554990325301252";
const SEARCH_QUERY = "sjer";

function noop(): void {
  // Story callbacks are deliberately inert.
}

const CHANNELS = [
  { id: "1102938475610293847", name: "match-reports" },
  { id: "1102938475610293848", name: "ranked-grind" },
];

/**
 * `PlayerAliasCombobox` debounces its own search, but its first debounced value
 * is the initial `value`, so the seeded key is the one it asks for on mount.
 */
const seedAliasSearch: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.player.listPlayers.queryOptions({
      guildId: GUILD_ID,
      query: SEARCH_QUERY,
      limit: 20,
    }).queryKey,
    {
      items: [
        {
          id: 42,
          alias: "sjerred",
          discordId: "444",
          discordUser: {
            id: "444",
            username: "sjerred",
            displayName: "Jerred",
            avatar: null,
          },
          updatedTime: "2026-09-12T22:41:00.000Z",
          accountCount: 2,
          subscriptionCount: 2,
          channelIds: ["1102938475610293847", "1102938475610293848"],
        },
        {
          id: 43,
          alias: "sjerred-smurf",
          discordId: null,
          discordUser: null,
          updatedTime: "2026-09-10T11:03:00.000Z",
          accountCount: 1,
          subscriptionCount: 1,
          channelIds: ["1102938475610293847"],
        },
      ],
      nextCursor: null,
    },
  );
};

const SUBSCRIPTIONS: PlayerSubscriptionRow[] = [
  {
    id: 1,
    channelId: "1102938475610293847",
    creatorDiscordId: "444",
    creatorDiscordUser: { username: "sjerred", displayName: "Jerred" },
    createdTime: "2026-06-01T18:30:00.000Z",
    filters: {
      version: 1,
      filters: [{ type: "queue", queues: ["solo", "clash"] }],
    },
    isMuted: false,
  },
  {
    id: 2,
    channelId: "1102938475610293848",
    creatorDiscordId: "445",
    creatorDiscordUser: { username: "chovy", displayName: "Chovy" },
    createdTime: "2026-07-14T09:05:00.000Z",
    filters: null,
    isMuted: true,
  },
];

const MATCH_ENTRIES = [
  {
    matchId: "NA1_5182736451",
    gameCreationMs: Date.now() - 7_200_000,
    gameDurationSeconds: 1942,
    queue: "Ranked Solo/Duo",
    championName: "Ahri",
    teamPosition: "MIDDLE",
    win: true,
    kills: 11,
    deaths: 2,
    assists: 9,
    creepScore: 241,
    csPerMinute: 7.4,
    killParticipation: 0.66,
    leaguePointsDelta: 23,
    account: { gameName: "sjerred", tagLine: "NA1", region: "NA" },
  },
  {
    matchId: "NA1_5182701122",
    gameCreationMs: Date.now() - 172_800_000,
    gameDurationSeconds: 2104,
    queue: "Clash",
    championName: "Thresh",
    teamPosition: "UTILITY",
    win: false,
    kills: 1,
    deaths: 7,
    assists: 18,
    creepScore: 42,
    csPerMinute: 1.2,
    killParticipation: 0.63,
    leaguePointsDelta: null,
    account: { gameName: "sjerred", tagLine: "NA1", region: "NA" },
  },
];

const MANAGER_PERMISSIONS = createPermissionSet(
  ROLE_CATALOG.manager.permissions,
);

function AliasComboboxHarness(props: { initial: string }) {
  const [alias, setAlias] = useState(props.initial);
  return (
    <div className="max-w-sm space-y-1">
      <Label htmlFor="story-alias">Player</Label>
      <PlayerAliasCombobox
        id="story-alias"
        name="alias"
        guildId={GUILD_ID}
        value={alias}
        onChange={setAlias}
      />
    </div>
  );
}

function AliasFormFieldHarness() {
  const [alias, setAlias] = useState("");
  return (
    <div className="max-w-sm">
      <PlayerAliasFormField
        id="story-merge-alias"
        label="Merge into player"
        guildId={GUILD_ID}
        field={{
          name: "alias",
          state: { value: alias, meta: { isTouched: true, errors: [] } },
          handleChange: setAlias,
        }}
      />
    </div>
  );
}

function SubscriptionsManagerHarness() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <PlayerSubscriptionsManager
        guildId={GUILD_ID}
        alias="sjerred"
        subscriptions={SUBSCRIPTIONS}
        channels={CHANNELS}
        perms={MANAGER_PERMISSIONS}
        refresh={noop}
        setActionError={setError}
      />
      {error === null ? null : (
        <p role="alert" className="text-sm text-scout-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const meta = {
  title: "Player/Management",
  component: RecordedMatchHistory,
  tags: ["autodocs"],
  parameters: { routerEntries: [`/g/${GUILD_ID}/players/sjerred`] },
} satisfies Meta<typeof RecordedMatchHistory>;

export default meta;

type Story = StoryObj<typeof meta>;

const historyArgs = {
  history: Loaded.done(MATCH_ENTRIES),
  fetching: false,
  refetching: false,
  entries: MATCH_ENTRIES,
  nextCursor: {
    gameCreationMs: MATCH_ENTRIES[1]?.gameCreationMs ?? 0,
    matchId: "NA1_5182701122",
  },
  page: 0,
  playerId: 42,
  profileSearch: "?games=50",
  onRetry: noop,
  onPrevious: noop,
  onNext: noop,
};

export const RecordedMatches: Story = { args: historyArgs };

export const RecordedMatchesEmpty: Story = {
  args: { ...historyArgs, entries: [], nextCursor: null },
};

export const RecordedMatchesFailed: Story = {
  args: {
    ...historyArgs,
    history: Loaded.failed(new Error("Report lake unavailable"), ["history"]),
  },
};

export const AliasComboboxSeeded: Story = {
  args: historyArgs,
  parameters: { seedQueries: [seedAliasSearch] },
  render: () => <AliasComboboxHarness initial={SEARCH_QUERY} />,
};

export const AliasComboboxEmpty: Story = {
  args: historyArgs,
  render: () => <AliasComboboxHarness initial="" />,
};

export const AliasFormField: Story = {
  args: historyArgs,
  render: () => <AliasFormFieldHarness />,
};

export const SubscriptionsManager: Story = {
  args: historyArgs,
  render: () => <SubscriptionsManagerHarness />,
};
