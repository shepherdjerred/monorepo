import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CompetitionCriteriaSchema,
  CompetitionIdSchema,
  P,
  PlayerIdSchema,
  type Permission,
} from "@scout-for-lol/data";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import { CompetitionLeaderboardPanel } from "./competition-leaderboard-panel.tsx";
import { CompetitionParticipantsPanel } from "./competition-participants-panel.tsx";

const GUILD_ID = "1084396924348997663";
const COMPETITION_ID = CompetitionIdSchema.parse(31);

const CRITERIA = CompetitionCriteriaSchema.parse({
  type: "MOST_GAMES_PLAYED",
  queues: ["solo", "flex"],
});

const READ_ONLY_PERMISSIONS: Permission[] = [
  P("competitions", "read"),
  P("players", "read"),
];

const ORGANIZER_PERMISSIONS: Permission[] = [
  ...READ_ONLY_PERMISSIONS,
  P("competitions", "update"),
  P("competitions", "invite"),
  P("competitions", "refresh"),
];

/**
 * `usePermissions` reads the cached `guild.listManageable` entry, so seeding
 * that one query decides every permission-gated control in both panels.
 */
function seedPermissions(permissions: Permission[]): StorySeed {
  return (trpc, queryClient) => {
    queryClient.setQueryData(
      trpc.guild.listManageable.queryOptions().queryKey,
      [
        {
          id: GUILD_ID,
          name: "Summoner's Rift Club",
          icon: null,
          isOwner: false,
          isDiscordAdmin: false,
          customNightsEnabled: true,
          hallOfFameEnabled: true,
          mvpVotesEnabled: false,
          permissions,
        },
      ],
    );
  };
}

function seedLeaderboard(entries: number): StorySeed {
  return (trpc, queryClient) => {
    queryClient.setQueryData(
      trpc.competition.leaderboard.queryOptions({
        guildId: GUILD_ID,
        competitionId: COMPETITION_ID,
      }).queryKey,
      entries === 0
        ? null
        : {
            version: "v1",
            competitionId: COMPETITION_ID,
            calculatedAt: "2026-09-13T17:55:12.000Z",
            entries: [
              {
                playerId: PlayerIdSchema.parse(11),
                playerName: "jerred",
                score: 42,
                metadata: { winningQueue: "solo" },
                rank: 1,
              },
              {
                playerId: PlayerIdSchema.parse(12),
                playerName: "bryan",
                score: 37,
                metadata: { winningQueue: "flex" },
                rank: 2,
              },
              {
                playerId: PlayerIdSchema.parse(13),
                playerName: "hunter",
                score: 19,
                rank: 3,
              },
            ],
          },
    );
  };
}

const seedParticipantNames: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.discord.resolveUsers.queryOptions({
      ids: ["111", "222"],
    }).queryKey,
    {
      "111": {
        id: "111",
        username: "jerred",
        displayName: "jerred",
        avatar: null,
      },
      "222": {
        id: "222",
        username: "bryan",
        displayName: "bryan",
        avatar: null,
      },
    },
  );
};

const PARTICIPANTS = [
  {
    id: 501,
    playerId: 11,
    alias: "jerred",
    discordId: "111",
    status: "ACTIVE",
    invitedBy: "111",
    invitedAt: "2026-09-13T16:00:00.000Z",
    joinedAt: "2026-09-13T16:02:00.000Z",
    leftAt: null,
  },
  {
    id: 502,
    playerId: 12,
    alias: "bryan",
    discordId: "222",
    status: "INVITED",
    invitedBy: "111",
    invitedAt: "2026-09-13T16:05:00.000Z",
    joinedAt: null,
    leftAt: null,
  },
  {
    id: 503,
    playerId: 13,
    alias: "hunter",
    discordId: null,
    status: "LEFT",
    invitedBy: "111",
    invitedAt: "2026-09-12T18:00:00.000Z",
    joinedAt: "2026-09-12T18:04:00.000Z",
    leftAt: "2026-09-13T09:30:00.000Z",
  },
];

const noop = () => {
  // Stories never refetch; the parent route owns the invalidation.
};

const meta = {
  title: "Competition/Panels",
  component: CompetitionLeaderboardPanel,
  tags: ["autodocs"],
} satisfies Meta<typeof CompetitionLeaderboardPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

const LEADERBOARD_ARGS = {
  guildId: GUILD_ID,
  competitionId: COMPETITION_ID,
  status: "ACTIVE",
  startDate: "2026-09-01T07:00:00.000Z",
  endDate: "2026-10-26T06:59:59.000Z",
  analysisTimezone: "America/Los_Angeles",
  criteria: CRITERIA,
} satisfies StoryObj<typeof meta>["args"];

export const Standings: Story = {
  args: LEADERBOARD_ARGS,
  parameters: {
    seedQueries: [seedPermissions(ORGANIZER_PERMISSIONS), seedLeaderboard(3)],
  },
};

export const StandingsReadOnly: Story = {
  args: LEADERBOARD_ARGS,
  parameters: {
    seedQueries: [seedPermissions(READ_ONLY_PERMISSIONS), seedLeaderboard(3)],
  },
};

export const StandingsNotComputed: Story = {
  args: LEADERBOARD_ARGS,
  parameters: {
    seedQueries: [seedPermissions(ORGANIZER_PERMISSIONS), seedLeaderboard(0)],
  },
};

export const StandingsDraft: Story = {
  args: { ...LEADERBOARD_ARGS, status: "DRAFT" },
  parameters: { seedQueries: [seedPermissions(ORGANIZER_PERMISSIONS)] },
};

export const Participants: Story = {
  args: LEADERBOARD_ARGS,
  parameters: {
    seedQueries: [seedPermissions(ORGANIZER_PERMISSIONS), seedParticipantNames],
  },
  render: () => (
    <CompetitionParticipantsPanel
      guildId={GUILD_ID}
      competitionId={COMPETITION_ID}
      status="ACTIVE"
      visibility="INVITE_ONLY"
      participants={PARTICIPANTS}
      onChanged={noop}
    />
  ),
};

export const ParticipantsReadOnly: Story = {
  args: LEADERBOARD_ARGS,
  parameters: {
    seedQueries: [seedPermissions(READ_ONLY_PERMISSIONS), seedParticipantNames],
  },
  render: () => (
    <CompetitionParticipantsPanel
      guildId={GUILD_ID}
      competitionId={COMPETITION_ID}
      status="ENDED"
      visibility="OPEN"
      participants={PARTICIPANTS}
      onChanged={noop}
    />
  ),
};

export const ParticipantsEmpty: Story = {
  args: LEADERBOARD_ARGS,
  parameters: { seedQueries: [seedPermissions(ORGANIZER_PERMISSIONS)] },
  render: () => (
    <CompetitionParticipantsPanel
      guildId={GUILD_ID}
      competitionId={COMPETITION_ID}
      status="DRAFT"
      visibility="SERVER_WIDE"
      participants={[]}
      onChanged={noop}
    />
  ),
};
