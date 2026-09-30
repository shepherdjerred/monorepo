import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DiscordGuildIdSchema,
  ExploreTraceEntrySchema,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import type {
  CreationConfirmationOutcome,
  IntentConfirmationOutcome,
} from "#src/lib/intent-confirmation.ts";
import type {
  CreationIntentCardData,
  DareDraftCardData,
  DareIntentCardData,
} from "#src/lib/explore/explore-intent-cards.ts";
import { ExploreIntentCards } from "./explore-intent-cards.tsx";
import {
  ConfirmationOutcomeMessage,
  ExploreConfirmationCard,
} from "./explore-confirmation-card.tsx";
import { CreationConfirmationView } from "./explore-creation-intent-card.tsx";
import {
  ExploreDareDraftCard,
  ExploreDareIntentCard,
} from "./explore-dare-intent-card.tsx";

/**
 * The cards a turn produces when the agent proposes something a human must
 * authorize — a Bryan Bucks dare or one of the three Explore creations.
 *
 * The live cards (`ExploreDareIntentCard`, `ExploreCreationIntentCard`) each
 * read their intent's persisted status. Left unseeded here, that query stays
 * pending, which is exactly the unconfirmed state these cards are about.
 */
const meta = {
  title: "Explore/Intent",
  component: ExploreIntentCards,
  tags: ["autodocs"],
} satisfies Meta<typeof ExploreIntentCards>;

export default meta;

type Story = StoryObj<typeof meta>;

function noop(): void {
  // Story callbacks: the catalog drives no navigation, mutation or stream.
}

const GUILD_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const CREATION_INTENT_ID = "55555555-5555-4555-8555-555555555555";
const DARE_INTENT_ID = "66666666-6666-4666-8666-666666666666";
const TEN_MINUTES_MS = 10 * 60_000;

/** Alive when the story renders, so the owner's card reads as pending. */
const EXPIRES_AT = new Date(Date.now() + 9 * 60_000).toISOString();

const CREATION_INTENT: CreationIntentCardData = {
  intentId: CREATION_INTENT_ID,
  kind: "report",
  guildId: GUILD_ID,
  expiresAt: EXPIRES_AT,
  summary:
    "A weekly Ranked Solo/Duo KDA report for the tracked roster, posted to #scout-reports every Monday at 09:00 PT.",
};

const DARE_DRAFT: DareDraftCardData = {
  dareId: 42,
  revision: 3,
  canonicalScoutQl:
    "SELECT kills FROM matches WHERE player = 'Hide on bush#KR1' AND champion = 'Ahri'",
  plainLanguage:
    "Hide on bush gets a pentakill on Ahri before the end of Patch 16.17.",
  semanticProofPlan:
    "Settles from ingested Ranked Solo/Duo matches on Patch 16.17 where the champion is Ahri and pentaKills is at least 1.",
  openingStake: 250,
  targetAliases: ["Hide on bush#KR1"],
  originalText: "bet faker pentas on ahri this patch",
  sqlIsBinding: true,
};

const DARE_INTENT: DareIntentCardData = {
  intentId: DARE_INTENT_ID,
  action: "fund",
  expiresAt: EXPIRES_AT,
  dareId: 42,
  revision: 3,
  originalText: "bet faker pentas on ahri this patch",
  plainLanguage:
    "Hide on bush gets a pentakill on Ahri before the end of Patch 16.17.",
  semanticProofPlan:
    "Settles from ingested Ranked Solo/Duo matches on Patch 16.17 where the champion is Ahri and pentaKills is at least 1.",
  canonicalScoutQl:
    "SELECT kills FROM matches WHERE player = 'Hide on bush#KR1' AND champion = 'Ahri'",
  sqlIsBinding: true,
};

const CREATED_OUTCOME: CreationConfirmationOutcome = {
  status: "confirmed",
  message: "Created the weekly KDA report and scheduled its first run.",
  created: { entity: "report", entityId: 118, guildId: GUILD_ID },
};

const REFUSED_OUTCOME: CreationConfirmationOutcome = {
  status: "failed",
  message: "This server already has the maximum number of scheduled reports.",
  reason: "limit_reached",
};

const FUNDED_OUTCOME: IntentConfirmationOutcome = {
  status: "confirmed",
  message: "funded",
  retryable: false,
  deliveryWarning: null,
};

function trace(entries: readonly unknown[]): ExploreTraceEntry[] {
  return entries.map((value, index) =>
    ExploreTraceEntrySchema.parse({
      toolCallId: `intent-call-${String(index)}`,
      toolName: "prepare_action",
      message: "Nothing has been created yet.",
      status: "succeeded",
      durationMs: 30,
      details: null,
      rawInput: null,
      rawOutput: { kind: "value", value, byteLength: 320 },
    }),
  );
}

/**
 * A turn that proposed three things at once, read back out of its persisted
 * trace exactly as the owner's transcript renders it.
 */
export const CardsFromTrace: Story = {
  args: {
    trace: trace([
      { kind: "created", message: "Drafted the dare.", data: DARE_DRAFT },
      {
        kind: "confirmation_required",
        message: "Funding needs your confirmation.",
        data: DARE_INTENT,
      },
      {
        kind: "creation_confirmation_required",
        message: "Nothing has been created yet.",
        intent: CREATION_INTENT,
      },
    ]),
  },
};

export const DareDraft: Story = {
  args: { trace: [] },
  render: () => <ExploreDareDraftCard draft={DARE_DRAFT} />,
};

/** The live dare card, unconfirmed: one button and a countdown. */
export const DareFundingPending: Story = {
  args: { trace: [] },
  render: () => <ExploreDareIntentCard intent={DARE_INTENT} />,
};

export const CreationPending: Story = {
  args: { trace: [] },
  render: () => (
    <CreationConfirmationView
      intent={CREATION_INTENT}
      outcome={null}
      expiresInMs={TEN_MINUTES_MS}
      expired={false}
      confirming={false}
      errorMessage={null}
      onConfirm={noop}
    />
  ),
};

/** Settled: the clock is gone and the created entity is linked. */
export const CreationConfirmed: Story = {
  args: { trace: [] },
  render: () => (
    <CreationConfirmationView
      intent={CREATION_INTENT}
      outcome={CREATED_OUTCOME}
      expiresInMs={0}
      expired={false}
      confirming={false}
      errorMessage={null}
      onConfirm={noop}
    />
  ),
};

/** Every other state the shared confirmation shell has to read correctly. */
export const ConfirmationShellStates: Story = {
  args: { trace: [] },
  render: () => (
    <div className="space-y-3">
      <CreationConfirmationView
        intent={{ ...CREATION_INTENT, kind: "subscription" }}
        outcome={null}
        expiresInMs={0}
        expired
        confirming={false}
        errorMessage={null}
        onConfirm={noop}
      />
      <CreationConfirmationView
        intent={{ ...CREATION_INTENT, kind: "competition" }}
        outcome={REFUSED_OUTCOME}
        expiresInMs={0}
        expired={false}
        confirming={false}
        errorMessage={null}
        onConfirm={noop}
      />
      <ExploreConfirmationCard
        state="confirming"
        heading="Confirm fund"
        expiresInMs={2 * 60_000 + 14_000}
      >
        <p className="text-sm text-scout-subtle">Dare #42, revision 3.</p>
      </ExploreConfirmationCard>
      <ExploreConfirmationCard
        state="confirmed"
        heading="Action confirmed"
        expiresInMs={0}
        footer={
          <ConfirmationOutcomeMessage
            status={FUNDED_OUTCOME.status}
            message={FUNDED_OUTCOME.message}
            capitalize
          />
        }
      >
        <p className="text-sm text-scout-subtle">Dare #42, revision 3.</p>
      </ExploreConfirmationCard>
    </div>
  ),
};
