import type { Meta, StoryObj } from "@storybook/react-vite";
import { ALL_PERMISSIONS, type ExploreConversation } from "@scout-for-lol/data";
import { storyConversation } from "#src/lib/storybook/story-fixtures.ts";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import { AppNavigation } from "./app-navigation.tsx";
import { UserMenu } from "./user-menu.tsx";

/**
 * The signed-in chrome: the left sidebar the whole workspace hangs off, and
 * the account dropdown anchored to the navbar's `@username`.
 */
const meta = {
  title: "Chrome/App Shell",
  component: AppNavigation,
  tags: ["autodocs"],
} satisfies Meta<typeof AppNavigation>;

export default meta;

type Story = StoryObj<typeof meta>;

const GUILD_ID = "1337623164146155593";
const SECOND_GUILD_ID = "1102222222222222222";

const CONVERSATIONS: ExploreConversation[] = [
  storyConversation(
    "11111111-1111-4111-8111-111111111111",
    "Ahri win rate by patch",
    12,
  ),
  storyConversation(
    "22222222-2222-4222-8222-222222222222",
    "Who has the most pentakills?",
    90,
  ),
  storyConversation(
    "33333333-3333-4333-8333-333333333333",
    "Jungle first-clear timings",
    3 * 24 * 60,
  ),
];

/** Everything the sidebar asks for, with every consumer tool switched on. */
const seedEverythingEnabled: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(trpc.guild.listManageable.queryOptions().queryKey, [
    {
      id: GUILD_ID,
      name: "Summoner's Lounge",
      icon: null,
      isOwner: true,
      isDiscordAdmin: true,
      customNightsEnabled: true,
      hallOfFameEnabled: true,
      mvpVotesEnabled: true,
      permissions: [...ALL_PERMISSIONS],
    },
  ]);
  queryClient.setQueryData(trpc.explore.status.queryOptions().queryKey, {
    enabled: true,
    quota: [],
  });
  queryClient.setQueryData(
    trpc.consumerPlayer.status.queryOptions(undefined).queryKey,
    { state: "available", guildCount: 1 },
  );
  queryClient.setQueryData(trpc.challenge.status.queryOptions().queryKey, {
    enabled: true,
  });
  queryClient.setQueryData(trpc.bucks.status.queryOptions().queryKey, {
    state: "available",
    guilds: [{ id: GUILD_ID, name: "Summoner's Lounge", daresAvailable: true }],
  });
  queryClient.setQueryData(trpc.hall.status.queryOptions().queryKey, {
    state: "available",
    guilds: [{ id: GUILD_ID, name: "Summoner's Lounge", icon: null }],
  });
  queryClient.setQueryData(trpc.duel.status.queryOptions(undefined).queryKey, {
    state: "available",
    guilds: [{ id: GUILD_ID, name: "Summoner's Lounge", icon: null }],
  });
  queryClient.setQueryData(
    trpc.operations.availability.queryOptions(undefined).queryKey,
    { temporal: "available" },
  );
};

/** A second manageable server, which is what reveals the workspace switcher. */
const seedTwoGuilds: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(trpc.guild.listManageable.queryOptions().queryKey, [
    {
      id: GUILD_ID,
      name: "Summoner's Lounge",
      icon: null,
      isOwner: true,
      isDiscordAdmin: true,
      customNightsEnabled: true,
      hallOfFameEnabled: true,
      mvpVotesEnabled: true,
      permissions: [...ALL_PERMISSIONS],
    },
    {
      id: SECOND_GUILD_ID,
      name: "Baron Steal Society",
      icon: null,
      isOwner: false,
      isDiscordAdmin: false,
      customNightsEnabled: false,
      hallOfFameEnabled: false,
      mvpVotesEnabled: false,
      permissions: [{ resource: "reports", action: "read" }],
    },
  ]);
};

const seedConversations: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(trpc.explore.list.queryOptions().queryKey, [
    ...CONVERSATIONS,
  ]);
};

/** Every feature gate answered "off", so only the server sections remain. */
const seedToolsDisabled: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(trpc.explore.status.queryOptions().queryKey, {
    enabled: false,
    quota: [],
  });
  queryClient.setQueryData(
    trpc.consumerPlayer.status.queryOptions(undefined).queryKey,
    { state: "feature_disabled" },
  );
  queryClient.setQueryData(trpc.challenge.status.queryOptions().queryKey, {
    enabled: false,
  });
  queryClient.setQueryData(trpc.bucks.status.queryOptions().queryKey, {
    state: "feature_disabled",
  });
  queryClient.setQueryData(trpc.hall.status.queryOptions().queryKey, {
    state: "feature_disabled",
    guilds: [],
  });
  queryClient.setQueryData(trpc.duel.status.queryOptions(undefined).queryKey, {
    state: "feature_disabled",
    guilds: [],
  });
  // `operations.availability` has no "disabled" success shape — the real
  // backend throws NOT_FOUND instead (see the router). Removing the query
  // `seedEverythingEnabled` wrote restores the pending state the transport
  // never settles out of, which `AppNavigation` treats identically to that
  // error: no data, so the console link stays hidden.
  queryClient.removeQueries({
    queryKey: trpc.operations.availability.queryOptions(undefined).queryKey,
  });
};

export const NavigationInExplore: Story = {
  parameters: {
    routerEntries: ["/explore/11111111-1111-4111-8111-111111111111"],
    seedQueries: [seedEverythingEnabled, seedConversations],
  },
};

export const NavigationInGuildWorkspace: Story = {
  parameters: {
    routerEntries: [`/g/${GUILD_ID}/reports`],
    seedQueries: [seedEverythingEnabled, seedTwoGuilds],
  },
};

export const NavigationToolsDisabled: Story = {
  parameters: {
    routerEntries: [`/g/${GUILD_ID}/players`],
    seedQueries: [seedEverythingEnabled, seedToolsDisabled],
  },
};

/**
 * No seeds: the story transport never settles, so every availability query
 * stays pending and the sidebar renders the nothing-known-yet state.
 */
export const NavigationLoading: Story = {
  parameters: { routerEntries: ["/"] },
};

export const AccountMenu: Story = {
  render: () => (
    <div className="flex justify-end">
      <UserMenu username="faker" />
    </div>
  ),
};
