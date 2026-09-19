import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerIdSchema } from "@scout-for-lol/data";
import { DirectDuelForm } from "./direct-duel-form.tsx";
import { DuelEventCreateForm } from "./duel-event-create-form.tsx";
import { DuelEventRegistrationForms } from "./duel-event-registration-forms.tsx";
import {
  DuelOptionSelectField,
  FirstTurretField,
} from "./duel-form-fields.tsx";

const GUILD_ID = "1084396924348997663";

const CHANNELS = [
  { id: "1084396924348997666", name: "league-reports" },
  { id: "1084396924348997667", name: "duels" },
];

const ACCOUNTS = [
  { accountId: 901, accountAlias: "jerred#NA1", playerAlias: "jerred" },
  { accountId: 902, accountAlias: "bryanbucks#NA1", playerAlias: "bryan" },
  { accountId: 903, accountAlias: "huntergatherer#NA1", playerAlias: "hunter" },
  { accountId: 904, accountAlias: "midorfeed#NA1", playerAlias: "casey" },
];

const ENTRANT_ACCOUNTS = ACCOUNTS.map((account, index) => ({
  ...account,
  playerId: PlayerIdSchema.parse(11 + index),
}));

const noop = () => {
  // Stories never create a duel; the mutation belongs to the real route.
};

/** The bare duel fields are controlled, so the story owns their state. */
function DuelFieldHarness() {
  const [firstTurret, setFirstTurret] = useState(false);
  const [bestOf, setBestOf] = useState("3");
  return (
    <div className="flex flex-wrap items-end gap-6">
      <DuelOptionSelectField
        id="story-duel-best-of"
        name="bestOf"
        label="Series"
        value={bestOf}
        placeholder="Pick a series length"
        options={[
          { value: "1", label: "Best of 1" },
          { value: "3", label: "Best of 3" },
          { value: "5", label: "Best of 5" },
        ]}
        onChange={setBestOf}
      />
      <FirstTurretField
        id="story-duel-first-turret"
        name="firstTurret"
        checked={firstTurret}
        onBlur={() => {
          // Touched tracking belongs to the real form.
        }}
        onChange={setFirstTurret}
      />
    </div>
  );
}

const meta = {
  title: "Competition/Duels",
  component: DirectDuelForm,
  tags: ["autodocs"],
} satisfies Meta<typeof DirectDuelForm>;

export default meta;

type Story = StoryObj<typeof meta>;

const DIRECT_ARGS = {
  guildId: GUILD_ID,
  accounts: ACCOUNTS,
  channels: CHANNELS,
  onCreated: noop,
} satisfies StoryObj<typeof meta>["args"];

export const DirectChallenge: Story = { args: DIRECT_ARGS };

export const DirectChallengeWithoutChannels: Story = {
  args: { ...DIRECT_ARGS, channels: [] },
};

export const EventCreate: Story = {
  args: DIRECT_ARGS,
  render: () => (
    <DuelEventCreateForm
      guildId={GUILD_ID}
      channels={CHANNELS}
      onCreated={noop}
    />
  ),
};

export const OpenRegistration: Story = {
  args: DIRECT_ARGS,
  render: () => (
    <DuelEventRegistrationForms
      registrationOpen={true}
      registrationMode="open"
      competitorKind="player"
      linkedAccounts={ENTRANT_ACCOUNTS.slice(0, 2)}
      eligibleAccounts={ENTRANT_ACCOUNTS}
      canInvite={true}
      registerPending={false}
      invitePending={false}
      onRegister={noop}
      onInvite={noop}
    />
  ),
};

export const InviteOnlyPairRegistration: Story = {
  args: DIRECT_ARGS,
  render: () => (
    <DuelEventRegistrationForms
      registrationOpen={true}
      registrationMode="invitations"
      competitorKind="pair"
      linkedAccounts={ENTRANT_ACCOUNTS.slice(0, 2)}
      eligibleAccounts={ENTRANT_ACCOUNTS}
      canInvite={true}
      registerPending={false}
      invitePending={true}
      onRegister={noop}
      onInvite={noop}
    />
  ),
};

export const DuelFields: Story = {
  args: DIRECT_ARGS,
  render: () => <DuelFieldHarness />,
};
