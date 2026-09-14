import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RiotIdCombobox } from "./riot-id-combobox.tsx";
import { DiscordMemberCombobox } from "./discord-member-combobox.tsx";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
import type { RegionValue } from "#src/lib/regions.ts";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";

/** Stories have no backend, so every handler is deliberately inert. */
function noop(): void {
  // Intentionally empty.
}

const GUILD_ID = "469558207670419456";
const REGION: RegionValue = "AMERICA_NORTH";

const PARTIAL_QUERY = "Bald";
const EXACT_QUERY = "Bald Bard#NA1";

const SUGGESTIONS = [
  {
    gameName: "Bald Bard",
    tagLine: "NA1",
    region: "AMERICA_NORTH",
    tier: "GOLD II",
    avatar: null,
    source: "index",
  },
  {
    gameName: "Bald Bard",
    tagLine: "EUW",
    region: "EU_WEST",
    tier: "PLATINUM IV",
    avatar: null,
    source: "opgg",
  },
  {
    gameName: "Baldur",
    tagLine: "NA2",
    region: "AMERICA_NORTH",
    tier: null,
    avatar: null,
    source: "opgg",
  },
] as const;

const seedRiotSuggestions: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.riot.searchSummoners.queryOptions({
      guildId: GUILD_ID,
      query: PARTIAL_QUERY,
      region: REGION,
    }).queryKey,
    SUGGESTIONS.map((suggestion) => ({ ...suggestion })),
  );
};

// A Riot PUUID is 78 characters; padding a readable label keeps the fixture
// obviously synthetic rather than looking like a leaked credential.
const RESOLVED: RouterOutputs["riot"]["resolveRiotId"] = {
  kind: "ok",
  puuid: "story-puuid-bald-bard-na1".padEnd(78, "-"),
  gameName: "Bald Bard",
  tagLine: "NA1",
};

const seedRiotExact: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.riot.resolveRiotId.queryOptions({
      guildId: GUILD_ID,
      riotId: EXACT_QUERY,
      region: REGION,
    }).queryKey,
    RESOLVED,
  );
  queryClient.setQueryData(
    trpc.riot.searchSummoners.queryOptions({
      guildId: GUILD_ID,
      query: EXACT_QUERY,
      region: REGION,
    }).queryKey,
    [],
  );
};

const seedDiscordMembers: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.discord.searchMembers.queryOptions({
      guildId: GUILD_ID,
      query: PARTIAL_QUERY,
    }).queryKey,
    [
      {
        id: "193138290672074762",
        username: "baldbard",
        displayName: "Bald Bard",
        avatar: "https://cdn.discordapp.com/embed/avatars/1.png",
      },
      {
        id: "462734967650320384",
        username: "baldur",
        displayName: "Baldur",
        avatar: "https://cdn.discordapp.com/embed/avatars/3.png",
      },
    ],
  );
};

function RiotIdExample(props: { initial: string; disabled?: boolean }) {
  const [value, setValue] = useState(props.initial);
  return (
    <div className="max-w-md space-y-2">
      <label className="text-sm font-medium" htmlFor="story-riot-id">
        Riot ID <span className="text-scout-subtle">(name#TAG)</span>
      </label>
      <RiotIdCombobox
        id="story-riot-id"
        name="riotId"
        guildId={GUILD_ID}
        region={REGION}
        value={value}
        onValueChange={setValue}
        disabled={props.disabled ?? false}
      />
      <p className="text-xs text-scout-subtle">
        Focus the field to see the suggestion list.
      </p>
    </div>
  );
}

function DiscordMemberExample(props: { disabled?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <div className="max-w-md space-y-2">
      <label className="text-sm font-medium" htmlFor="story-discord-member">
        Discord user <span className="text-scout-subtle">(optional)</span>
      </label>
      <DiscordMemberCombobox
        id="story-discord-member"
        name="discordUserId"
        guildId={GUILD_ID}
        value={value}
        onChange={setValue}
        disabled={props.disabled ?? false}
      />
      <p className="text-xs text-scout-subtle">
        Type &quot;{PARTIAL_QUERY}&quot; to see the seeded members. Selected id:{" "}
        {value === "" ? "none" : value}
      </p>
    </div>
  );
}

const meta = {
  title: "Components/Comboboxes",
  component: RiotIdCombobox,
  tags: ["autodocs"],
} satisfies Meta<typeof RiotIdCombobox>;

export default meta;

type Story = StoryObj<typeof meta>;

const BASE_ARGS = {
  guildId: GUILD_ID,
  region: REGION,
  value: PARTIAL_QUERY,
  onValueChange: noop,
};

export const RiotIdSuggestions: Story = {
  args: BASE_ARGS,
  parameters: { seedQueries: [seedRiotSuggestions] },
  render: () => <RiotIdExample initial={PARTIAL_QUERY} />,
};

export const RiotIdExactMatch: Story = {
  args: BASE_ARGS,
  parameters: { seedQueries: [seedRiotExact] },
  render: () => <RiotIdExample initial={EXACT_QUERY} />,
};

export const RiotIdSearching: Story = {
  args: BASE_ARGS,
  render: () => <RiotIdExample initial="Hide on bush" />,
};

export const RiotIdDisabled: Story = {
  args: BASE_ARGS,
  parameters: { seedQueries: [seedRiotSuggestions] },
  render: () => <RiotIdExample initial={PARTIAL_QUERY} disabled />,
};

export const DiscordMemberSearch: Story = {
  args: BASE_ARGS,
  parameters: { seedQueries: [seedDiscordMembers] },
  render: () => <DiscordMemberExample />,
};

export const DiscordMemberDisabled: Story = {
  args: BASE_ARGS,
  render: () => <DiscordMemberExample disabled />,
};
