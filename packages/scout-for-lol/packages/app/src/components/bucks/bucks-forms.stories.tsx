import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@scout-for-lol/design-system/components/button";
import { BucksBetForm, type BucksBetSubmission } from "./bucks-bet-form.tsx";
import { BucksCancelDialog } from "./bucks-cancel-dialog.tsx";
import {
  BucksNotificationPreferencesForm,
  type BucksNotificationPreferencesView,
} from "./bucks-notification-preferences-form.tsx";

const noop = () => {
  // Stories never submit; the server owns every Bucks write.
};

const SIDE_OPTIONS = [
  { value: "100", label: "Blue side (jerred on Ahri)" },
  { value: "200", label: "Red side" },
];

/**
 * The cancel dialog is driven by its parent, so the story owns the open state.
 * The reopen trigger is rendered only while the dialog is closed: a modal
 * Radix dialog marks the rest of the page `aria-hidden`, and a focusable
 * control left behind it is an axe violation.
 */
function CancelDialogHarness(props: {
  position: { offeredStake: number; cancellationFee: number } | null;
  pending: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Cancel bet
      </Button>
    );
  }
  return (
    <>
      {/*
        Radix portals the dialog to document.body, so the story root would
        otherwise be empty while it is open. This caption keeps something
        mounted in the root, and stays text rather than a control because the
        open dialog marks everything behind it aria-hidden.
      */}
      <p className="text-xs text-scout-subtle">
        The cancel dialog is open over this story.
      </p>
      <BucksCancelDialog
        open={open}
        onOpenChange={setOpen}
        position={props.position}
        pending={props.pending}
        error={props.error}
        onConfirm={noop}
      />
    </>
  );
}

/** The preferences form is controlled by the server value it was hydrated from. */
function PreferencesHarness(props: {
  preferences: BucksNotificationPreferencesView;
  pending: boolean;
  error: string | null;
}) {
  const [saved, setSaved] = useState(props.preferences);
  return (
    <BucksNotificationPreferencesForm
      preferences={saved}
      pending={props.pending}
      error={props.error}
      onSubmit={setSaved}
    />
  );
}

const meta = {
  title: "Bucks/Forms",
  component: BucksBetForm,
  tags: ["autodocs"],
} satisfies Meta<typeof BucksBetForm>;

export default meta;

type Story = StoryObj<typeof meta>;

const submitted = (_submission: BucksBetSubmission) => {
  // The real surface hands this to `bucks.placeBet`; the story just absorbs it.
};

export const BetForm: Story = {
  args: {
    idPrefix: "bet-NA1_5021846713",
    sideOptions: SIDE_OPTIONS,
    balance: 3000,
    pending: false,
    serverError: null,
    onSubmit: submitted,
  },
};

export const BetFormPending: Story = {
  args: {
    idPrefix: "bet-pending-NA1_5021846713",
    sideOptions: SIDE_OPTIONS,
    balance: 3000,
    pending: true,
    serverError: null,
    onSubmit: submitted,
  },
};

export const BetFormRefused: Story = {
  args: {
    idPrefix: "bet-refused-NA1_5021846713",
    sideOptions: [SIDE_OPTIONS[0] ?? { value: "100", label: "Blue side" }],
    balance: 120,
    pending: false,
    serverError: "The betting window for this match has already closed.",
    submitLabel: "Add to bet",
    onSubmit: submitted,
  },
};

export const CancelDialog: Story = {
  args: {
    idPrefix: "cancel-dialog",
    sideOptions: SIDE_OPTIONS,
    balance: 3000,
    pending: false,
    serverError: null,
    onSubmit: submitted,
  },
  render: () => (
    <CancelDialogHarness
      position={{ offeredStake: 1000, cancellationFee: 50 }}
      pending={false}
      error={null}
    />
  ),
};

export const CancelDialogRefused: Story = {
  args: {
    idPrefix: "cancel-dialog-refused",
    sideOptions: SIDE_OPTIONS,
    balance: 3000,
    pending: false,
    serverError: null,
    onSubmit: submitted,
  },
  render: () => (
    <CancelDialogHarness
      position={null}
      pending={false}
      error="That bet was already matched and can no longer be cancelled."
    />
  ),
};

export const NotificationPreferences: Story = {
  args: {
    idPrefix: "notification-preferences",
    sideOptions: SIDE_OPTIONS,
    balance: 3000,
    pending: false,
    serverError: null,
    onSubmit: submitted,
  },
  render: () => (
    <PreferencesHarness
      preferences={{
        ownBetSettlementDms: true,
        betsOnPlayerSettlementDms: false,
        dareLifecycleDms: true,
        dareProgressDms: false,
      }}
      pending={false}
      error={null}
    />
  ),
};
