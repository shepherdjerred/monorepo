import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SubscriptionFilterSpec } from "@scout-for-lol/data";
import { AddSubscriptionDialog } from "./add-subscription-dialog.tsx";
import { SubscriptionChannelDialog } from "./subscription-channel-dialog.tsx";
import { SubscriptionFilterDialog } from "./subscription-filter-dialog.tsx";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";

/** Stories have no backend, so every handler is deliberately inert. */
function noop(): void {
  // Intentionally empty.
}

const GUILD_ID = "469558207670419456";

const CHANNELS = [
  { id: "1069813984308248657", name: "match-reports" },
  { id: "1069814032311730227", name: "ranked-only" },
  { id: "1069814077526343710", name: "aram-night" },
];

/**
 * The Riot ID and Discord member pickers only query once two characters are
 * typed, so these seeds answer the searches for "Bald" — typing that into
 * either field inside the dialog surfaces real rows instead of a spinner.
 */
const SEARCH_QUERY = "Bald";

const seedPickers: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.riot.searchSummoners.queryOptions({
      guildId: GUILD_ID,
      query: SEARCH_QUERY,
      region: "AMERICA_NORTH",
    }).queryKey,
    [
      {
        gameName: "Bald Bard",
        tagLine: "NA1",
        region: "AMERICA_NORTH",
        tier: "GOLD",
        avatar: null,
        source: "index",
      },
      {
        gameName: "Bald Bard",
        tagLine: "EUW",
        region: "EU_WEST",
        tier: "PLATINUM",
        avatar: null,
        source: "opgg",
      },
    ],
  );
  queryClient.setQueryData(
    trpc.discord.searchMembers.queryOptions({
      guildId: GUILD_ID,
      query: SEARCH_QUERY,
    }).queryKey,
    [
      {
        id: "193138290672074762",
        username: "baldbard",
        displayName: "Bald Bard",
        avatar: "https://cdn.discordapp.com/embed/avatars/1.png",
      },
    ],
  );
};

const RANKED_FILTERS: SubscriptionFilterSpec = {
  version: 1,
  filters: [{ type: "queue", queues: ["solo", "flex"] }],
};

const meta = {
  title: "Subscription/Dialogs",
  component: AddSubscriptionDialog,
  tags: ["autodocs"],
  parameters: { seedQueries: [seedPickers] },
} satisfies Meta<typeof AddSubscriptionDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

const BASE_ARGS = {
  guildId: GUILD_ID,
  channels: CHANNELS,
  open: true,
  onOpenChange: noop,
  onAdded: noop,
};

/**
 * Every story renders its dialog open. Only non-focusable text sits outside it:
 * Radix marks the story root `aria-hidden` while a dialog is open, so a
 * focusable sibling would fail the `aria-hidden-focus` axe rule.
 */
function Caption(props: { children: string }) {
  return <p className="text-sm text-scout-subtle">{props.children}</p>;
}

export const AddSubscription: Story = {
  args: BASE_ARGS,
  render: (args) => (
    <>
      <Caption>Add subscription — opened from the Subscriptions tab.</Caption>
      <AddSubscriptionDialog {...args} />
    </>
  ),
};

export const MoveChannel: Story = {
  args: BASE_ARGS,
  render: () => (
    <>
      <Caption>Move an existing subscription to another channel.</Caption>
      <SubscriptionChannelDialog
        guildId={GUILD_ID}
        channels={CHANNELS}
        action={{
          kind: "move",
          alias: "bald",
          fromChannelId: CHANNELS[0]?.id ?? "",
        }}
        onOpenChange={noop}
        onDone={noop}
      />
    </>
  ),
};

export const AddChannel: Story = {
  args: BASE_ARGS,
  render: () => (
    <>
      <Caption>Subscribe an existing player in a second channel.</Caption>
      <SubscriptionChannelDialog
        guildId={GUILD_ID}
        channels={CHANNELS}
        action={{ kind: "add-channel", alias: "vaughn" }}
        onOpenChange={noop}
        onDone={noop}
      />
    </>
  ),
};

export const EditFilters: Story = {
  args: BASE_ARGS,
  render: () => (
    <>
      <Caption>Edit the queue filters for one subscription.</Caption>
      <SubscriptionFilterDialog
        guildId={GUILD_ID}
        channels={CHANNELS}
        action={{
          kind: "edit",
          alias: "bald",
          channelId: CHANNELS[1]?.id ?? "",
          initial: RANKED_FILTERS,
        }}
        onOpenChange={noop}
        onDone={noop}
      />
    </>
  ),
};

export const BulkFilters: Story = {
  args: BASE_ARGS,
  render: () => (
    <>
      <Caption>Apply one queue filter to a whole channel.</Caption>
      <SubscriptionFilterDialog
        guildId={GUILD_ID}
        channels={CHANNELS}
        action={{ kind: "bulk" }}
        onOpenChange={noop}
        onDone={noop}
      />
    </>
  ),
};
