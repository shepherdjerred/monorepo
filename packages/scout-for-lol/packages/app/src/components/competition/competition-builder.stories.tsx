import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerIdSchema } from "@scout-for-lol/data";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import {
  initialCompetitionBuilderState,
  type CompetitionBuilderState,
} from "#src/lib/bucks/competition-builder-state.ts";
import { CompetitionBuilderBasics } from "./competition-builder-basics.tsx";
import { CompetitionBuilderEntrants } from "./competition-builder-entrants.tsx";
import { CompetitionBuilderReview } from "./competition-builder-review.tsx";

const GUILD_ID = "1084396924348997663";

const CHANNELS = [
  { id: "1084396924348997666", name: "league-reports" },
  { id: "1084396924348997667", name: "ranked-flex" },
];

const noop = () => {
  // Default args exist only so Storybook controls have a shape to show.
};

type BasicsErrors = ComponentProps<typeof CompetitionBuilderBasics>["errors"];

const NO_BASICS_ERRORS: BasicsErrors = {
  title: undefined,
  description: undefined,
  channelId: undefined,
  maxParticipants: undefined,
  visibility: undefined,
};

function builderState(
  overrides: Partial<CompetitionBuilderState>,
): CompetitionBuilderState {
  return {
    ...initialCompetitionBuilderState({
      channelId: CHANNELS[0]?.id ?? "",
      timezone: "America/Los_Angeles",
      now: new Date("2026-09-13T18:00:00.000Z"),
    }),
    ...overrides,
  };
}

const FILLED_STATE = builderState({
  title: "Fall Ranked Solo/Duo climb",
  description:
    "Most Ranked Solo/Duo games played between the start and end of the split.",
  maxParticipants: "24",
  visibility: "OPEN",
  analysisTimezone: "America/Los_Angeles",
  dates: {
    mode: "FIXED_DATES",
    startDate: "2026-09-14",
    endDate: "2026-10-26",
    seasonId: "",
  },
  criteria: {
    criteriaType: "MOST_GAMES_PLAYED",
    queues: ["solo", "flex"],
    aggregation: "MAX",
    championId: "",
    minGames: "10",
  },
  initialPlayerIds: [PlayerIdSchema.parse(11), PlayerIdSchema.parse(12)],
});

/** The basics step is fully controlled by the builder reducer in the real route. */
function BasicsHarness(props: {
  initial: CompetitionBuilderState;
  errors?: Partial<BasicsErrors>;
}) {
  const [state, setState] = useState(props.initial);
  return (
    <CompetitionBuilderBasics
      state={state}
      channels={CHANNELS}
      errors={{ ...NO_BASICS_ERRORS, ...props.errors }}
      onChange={(changes) => {
        setState((current) => ({ ...current, ...changes }));
      }}
    />
  );
}

function EntrantsHarness(props: {
  visibility: "OPEN" | "INVITE_ONLY" | "SERVER_WIDE";
  canInvite: boolean;
}) {
  const [selected, setSelected] = useState<number[]>([11]);
  return (
    <CompetitionBuilderEntrants
      guildId={GUILD_ID}
      visibility={props.visibility}
      selected={selected}
      cap={24}
      canInvite={props.canInvite}
      name="initialPlayerIds"
      onBlur={() => {
        // Touched-state tracking belongs to the real form.
      }}
      onChange={setSelected}
    />
  );
}

/**
 * `CompetitionBuilderEntrants` reads `player.listPlayers` with the empty search
 * it mounts with, so the seed must use that exact input.
 */
const seedTrackedPlayers: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.player.listPlayers.queryOptions({
      guildId: GUILD_ID,
      query: "",
      limit: 100,
    }).queryKey,
    {
      items: [
        {
          id: 11,
          alias: "jerred",
          discordId: "111",
          discordUser: {
            id: "111",
            username: "jerred",
            displayName: "jerred",
            avatar: null,
          },
          updatedTime: "2026-09-12T22:14:00.000Z",
          accountCount: 2,
          subscriptionCount: 1,
          channelIds: [CHANNELS[0]?.id ?? ""],
        },
        {
          id: 12,
          alias: "bryan",
          discordId: "222",
          discordUser: {
            id: "222",
            username: "bryan",
            displayName: "bryan",
            avatar: null,
          },
          updatedTime: "2026-09-11T18:02:00.000Z",
          accountCount: 1,
          subscriptionCount: 0,
          channelIds: [],
        },
        {
          id: 13,
          alias: "hunter",
          discordId: null,
          discordUser: null,
          updatedTime: "2026-09-09T04:20:00.000Z",
          accountCount: 1,
          subscriptionCount: 0,
          channelIds: [],
        },
      ],
      nextCursor: null,
    },
  );
};

const meta = {
  title: "Competition/Builder",
  component: CompetitionBuilderBasics,
  tags: ["autodocs"],
} satisfies Meta<typeof CompetitionBuilderBasics>;

export default meta;

type Story = StoryObj<typeof meta>;

const BASICS_ARGS = {
  state: FILLED_STATE,
  channels: CHANNELS,
  errors: NO_BASICS_ERRORS,
  onChange: noop,
} satisfies StoryObj<typeof meta>["args"];

export const Basics: Story = {
  args: BASICS_ARGS,
  render: () => <BasicsHarness initial={FILLED_STATE} />,
};

export const BasicsWithErrors: Story = {
  args: BASICS_ARGS,
  render: () => (
    <BasicsHarness
      initial={builderState({ title: "", maxParticipants: "1" })}
      errors={{
        title: "Give the competition a title members will recognise.",
        maxParticipants: "A competition needs at least 2 participants.",
      }}
    />
  ),
};

export const Entrants: Story = {
  args: BASICS_ARGS,
  parameters: { seedQueries: [seedTrackedPlayers] },
  render: () => <EntrantsHarness visibility="OPEN" canInvite={true} />,
};

export const EntrantsWithoutInvitePermission: Story = {
  args: BASICS_ARGS,
  render: () => <EntrantsHarness visibility="INVITE_ONLY" canInvite={false} />,
};

export const EntrantsServerWide: Story = {
  args: BASICS_ARGS,
  render: () => <EntrantsHarness visibility="SERVER_WIDE" canInvite={true} />,
};

export const Review: Story = {
  args: BASICS_ARGS,
  render: () => (
    <CompetitionBuilderReview
      state={FILLED_STATE}
      channelName={CHANNELS[0]?.name}
    />
  ),
};
