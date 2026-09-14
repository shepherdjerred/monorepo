import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
  type ChallengeProgress as ChallengeProgressValue,
} from "@scout-for-lol/data";
import { ChallengeProgress } from "./challenge-progress.tsx";
import { ChallengeChampionCoverage } from "./challenge-champion-coverage.tsx";
import {
  ChallengeAccountSelection,
  type ChallengeAccountOption,
} from "./challenge-account-selection.tsx";
import { ChallengeAccountEditor } from "./challenge-account-editor.tsx";
import { ConsumerPlayerChallengeRuns } from "./player-challenge-runs.tsx";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";

const PLAYER_ID = PlayerIdSchema.parse(42);

const SCALAR_PROGRESS: ChallengeProgressValue = {
  kind: "scalar",
  reducer: "consecutive_streak",
  current: 4,
  target: 10,
  completed: false,
};

const ROLE_PROGRESS: ChallengeProgressValue = {
  kind: "distinct",
  current: 2,
  target: 5,
  covered: [
    { value: "MIDDLE", label: "Mid" },
    { value: "JUNGLE", label: "Jungle" },
  ],
  missing: [
    { value: "TOP", label: "Top" },
    { value: "BOTTOM", label: "Bot" },
    { value: "UTILITY", label: "Support" },
  ],
  completed: false,
};

const CHAMPION_PROGRESS: ChallengeProgressValue = {
  kind: "distinct",
  current: 2,
  target: 5,
  covered: [
    { value: "103", label: "Ahri" },
    { value: "222", label: "Jinx" },
  ],
  missing: [
    { value: "266", label: "Aatrox" },
    { value: "64", label: "Lee Sin" },
    { value: "412", label: "Thresh" },
  ],
  completed: false,
};

const BOOLEAN_PROGRESS: ChallengeProgressValue = {
  kind: "boolean",
  operator: "all",
  completed: false,
  children: [
    SCALAR_PROGRESS,
    {
      kind: "scalar",
      reducer: "count",
      current: 30,
      target: 30,
      completed: true,
    },
    CHAMPION_PROGRESS,
  ],
};

const GUILD_ID = DiscordGuildIdSchema.parse("469558207670419456");

/**
 * Riot PUUIDs are exactly 78 characters, so story values are padded to that
 * length and parsed by the real schema. Padding a readable label keeps the
 * fixture obviously synthetic instead of looking like a leaked credential.
 */
function storyPuuid(label: string): string {
  return label.padEnd(78, "-");
}

const LINKED_ACCOUNTS: ChallengeAccountOption[] = [
  { id: 1, playerAlias: "bald", accountAlias: "Bald Bard #NA1" },
  { id: 2, playerAlias: "bald", accountAlias: "Smurf Bard #NA1" },
  { id: 3, playerAlias: "vaughn", accountAlias: "Jungle Diff #EUW" },
];

const seedLinkedAccounts: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.challenge.linkedAccounts.queryOptions().queryKey,
    LINKED_ACCOUNTS.map((account) => ({
      id: AccountIdSchema.parse(account.id),
      puuid: LeaguePuuidSchema.parse(
        storyPuuid(`story-puuid-account-${account.id.toString()}`),
      ),
      accountAlias: account.accountAlias,
      playerAlias: account.playerAlias,
      guildId: GUILD_ID,
    })),
  );
};

const seedProfileRuns: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.challenge.profileRunsByPlayerId.queryOptions({ playerId: PLAYER_ID })
      .queryKey,
    [
      {
        id: "0f6f4bd6-09f7-4f3a-9a09-9b0b8a5f2c11",
        templateId: "win-every-current-champion",
        title: "Win with every current champion",
        status: "active",
        recomputing: false,
        originalStartAt: "2026-01-04T00:00:00.000Z",
        completedAt: null,
        archivedAt: null,
      },
      {
        id: "2a3fd3f1-7d5c-4f2a-8a4d-3d5f4a2b1c99",
        templateId: "ranked-solo-streak",
        title: "Ten ranked wins in a row",
        status: "active",
        recomputing: true,
        originalStartAt: "2026-02-11T00:00:00.000Z",
        completedAt: null,
        archivedAt: null,
      },
      {
        id: "6b1f9d42-5b13-4a08-9a11-7c4f1e2d8b03",
        templateId: "all-roles",
        title: "Play every role in one week",
        status: "completed",
        recomputing: false,
        originalStartAt: "2025-12-01T00:00:00.000Z",
        completedAt: "2025-12-07T00:00:00.000Z",
        archivedAt: null,
      },
    ],
  );
};

function AccountSelectionExample() {
  const [selected, setSelected] = useState<number[]>([1]);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Riot accounts</legend>
      <ChallengeAccountSelection
        accounts={LINKED_ACCOUNTS}
        name="accountIds"
        value={selected}
        onChange={setSelected}
      />
      <p className="text-xs text-scout-subtle">
        {selected.length.toString()} account
        {selected.length === 1 ? "" : "s"} feed this run.
      </p>
    </fieldset>
  );
}

const meta = {
  title: "Challenge",
  component: ChallengeProgress,
  tags: ["autodocs"],
} satisfies Meta<typeof ChallengeProgress>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ScalarGoal: Story = {
  args: { progress: SCALAR_PROGRESS },
};

export const DistinctRoles: Story = {
  args: { progress: ROLE_PROGRESS },
};

export const CombinedGoals: Story = {
  args: { progress: BOOLEAN_PROGRESS },
};

export const ChampionCoverage: Story = {
  args: { progress: CHAMPION_PROGRESS },
  render: () => (
    <div className="max-w-md space-y-2">
      <p className="text-sm font-medium">Champion coverage</p>
      <ChallengeChampionCoverage
        entries={[
          { id: 266, label: "Aatrox", completed: false },
          { id: 103, label: "Ahri", completed: true },
          { id: 222, label: "Jinx", completed: true },
          { id: 64, label: "Lee Sin", completed: false },
          { id: 412, label: "Thresh", completed: false },
          { id: 62, label: "Wukong", completed: true },
        ]}
      />
    </div>
  ),
};

export const AccountSelection: Story = {
  args: { progress: SCALAR_PROGRESS },
  render: () => <AccountSelectionExample />,
};

export const AccountEditor: Story = {
  args: { progress: SCALAR_PROGRESS },
  parameters: { seedQueries: [seedLinkedAccounts] },
  render: () => (
    <ChallengeAccountEditor
      runId="0f6f4bd6-09f7-4f3a-9a09-9b0b8a5f2c11"
      runStatus="active"
      selectedAccounts={[{ accountId: 1 }, { accountId: 3 }]}
    />
  ),
};

export const PlayerRuns: Story = {
  args: { progress: SCALAR_PROGRESS },
  parameters: {
    seedQueries: [seedProfileRuns],
    routerEntries: ["/players/42"],
  },
  render: () => <ConsumerPlayerChallengeRuns playerId={PLAYER_ID} />,
};
