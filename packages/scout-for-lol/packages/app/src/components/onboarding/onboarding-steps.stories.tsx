import type { Meta, StoryObj } from "@storybook/react-vite";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
import { OnboardingConceptsStep } from "./onboarding-concepts-step.tsx";
import { OnboardingCompetitionStep } from "./onboarding-competition-step.tsx";
import { OnboardingDoneStep } from "./onboarding-done-step.tsx";
import { OnboardingChooseExtraStep } from "./onboarding-extras-choice-step.tsx";
import { OnboardingInstallStep } from "./onboarding-install-step.tsx";
import { OnboardingPickGuildStep } from "./onboarding-pick-guild-step.tsx";
import { OnboardingReportStep } from "./onboarding-report-step.tsx";
import { OnboardingSubscribeStep } from "./onboarding-subscribe-step.tsx";

const GUILD_ID = "377554990325301252";

const REPORTS_CHANNEL = "1102938475610293847";
const RANKED_CHANNEL = "1102938475610293848";

const CHANNELS = [
  { id: REPORTS_CHANNEL, name: "match-reports" },
  { id: RANKED_CHANNEL, name: "ranked-grind" },
  { id: "1102938475610293849", name: "general" },
];

const GUILDS = [
  {
    id: GUILD_ID,
    name: "Baron Steal Enjoyers",
    icon: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    isOwner: true,
  },
  {
    id: "377554990325301253",
    name: "Howling Abyss Regulars",
    icon: null,
    isOwner: false,
  },
];

const EXISTING_SUBS = [
  { alias: "sjerred", channelId: REPORTS_CHANNEL },
  { alias: "nightblue", channelId: REPORTS_CHANNEL },
  { alias: "Chovy", channelId: RANKED_CHANNEL },
];

function noop(): void {
  // Story callbacks are deliberately inert.
}

/**
 * The competition step gates its body on the builder-capabilities flag, so a
 * story that never seeds it renders "Loading builder…" forever.
 */
const seedBuilderV1: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.competition.builderCapabilities.queryOptions({ guildId: GUILD_ID })
      .queryKey,
    { builderV2Enabled: false },
  );
};

const meta = {
  title: "Onboarding/Steps",
  component: OnboardingConceptsStep,
  tags: ["autodocs"],
} satisfies Meta<typeof OnboardingConceptsStep>;

export default meta;

type Story = StoryObj<typeof meta>;

const stepArgs = { onNext: noop, onBack: noop, onSkip: noop };

export const ConceptsStep: Story = { args: stepArgs };

export const InstallStepFirstRun: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingInstallStep
      guildCount={0}
      isLoading={false}
      onRefresh={noop}
      onContinue={noop}
      onSkip={noop}
    />
  ),
};

export const InstallStepWithGuilds: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingInstallStep
      guildCount={2}
      isLoading={false}
      onRefresh={noop}
      onContinue={noop}
      onSkip={noop}
    />
  ),
};

export const PickGuildStep: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingPickGuildStep
      guilds={GUILDS}
      onSelect={noop}
      onBack={noop}
      onSkip={noop}
    />
  ),
};

export const SubscribeSelfStep: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingSubscribeStep
      mode="self"
      guildId={GUILD_ID}
      channels={CHANNELS}
      username="sjerred"
      discordId="444"
      existingSubs={[]}
      selfAlias=""
      selfChannelId=""
      onAdded={noop}
      onContinue={noop}
      onBack={noop}
      onSkip={noop}
    />
  ),
};

export const SubscribeMoreStep: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingSubscribeStep
      mode="more"
      guildId={GUILD_ID}
      channels={CHANNELS}
      username="sjerred"
      discordId="444"
      existingSubs={EXISTING_SUBS}
      selfAlias="sjerred"
      selfChannelId={REPORTS_CHANNEL}
      onAdded={noop}
      onContinue={noop}
      onBack={noop}
      onSkip={noop}
    />
  ),
};

/** Loaded teammate suggestions: the query key must match the component input. */
const seedTeammates: StorySeed = (trpc, queryClient) => {
  const seed: RouterOutputs["player"]["suggestTeammates"] = {
    kind: "ok",
    suggestions: [
      {
        puuid: "duo-puuid",
        gameName: "DuoQueue",
        tagLine: "NA1",
        riotId: "DuoQueue#NA1",
        region: "AMERICA_NORTH",
        gamesTogether: 7,
        lastPlayedMs: 1_771_000_000_000,
      },
      {
        puuid: "flex-puuid",
        gameName: "FlexFriend",
        tagLine: "EUW",
        riotId: "FlexFriend#EUW",
        region: "EU_WEST",
        gamesTogether: 3,
        lastPlayedMs: 1_770_500_000_000,
      },
    ],
  };
  queryClient.setQueryData(
    trpc.player.suggestTeammates.queryOptions({
      guildId: GUILD_ID,
      alias: "sjerred",
    }).queryKey,
    seed,
  );
};

export const SubscribeMoreWithSuggestions: Story = {
  args: stepArgs,
  parameters: { seedQueries: [seedTeammates] },
  render: () => (
    <OnboardingSubscribeStep
      mode="more"
      guildId={GUILD_ID}
      channels={CHANNELS}
      username="sjerred"
      discordId="444"
      existingSubs={EXISTING_SUBS}
      selfAlias="sjerred"
      selfChannelId={REPORTS_CHANNEL}
      onAdded={noop}
      onContinue={noop}
      onBack={noop}
      onSkip={noop}
    />
  ),
};

export const DoneStep: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingDoneStep
      subCount={3}
      onMore={noop}
      onFinish={noop}
      onBack={noop}
    />
  ),
};

export const ExtrasChoiceStep: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingChooseExtraStep onChoose={noop} onBack={noop} onSkip={noop} />
  ),
};

export const ReportStep: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingReportStep
      guildId={GUILD_ID}
      channels={CHANNELS}
      exampleId="games"
      onCreated={noop}
      onBack={noop}
      onSkip={noop}
    />
  ),
};

export const CompetitionStep: Story = {
  args: stepArgs,
  parameters: { seedQueries: [seedBuilderV1] },
  render: () => (
    <OnboardingCompetitionStep
      guildId={GUILD_ID}
      channels={CHANNELS}
      exampleId="games-sprint"
      onCreated={noop}
      onBack={noop}
      onSkip={noop}
    />
  ),
};

export const CompetitionStepLoading: Story = {
  args: stepArgs,
  render: () => (
    <OnboardingCompetitionStep
      guildId={GUILD_ID}
      channels={CHANNELS}
      exampleId="games-sprint"
      onCreated={noop}
      onBack={noop}
      onSkip={noop}
    />
  ),
};
