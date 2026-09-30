import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DiscordAccountIdSchema,
  ExploreConversationSchema,
  type ExploreConversation,
} from "@scout-for-lol/data";
import type { StorySeed } from "#src/lib/storybook/trpc-stub.ts";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog.tsx";
import { MergePlayersDialog } from "./merge-players-dialog.tsx";
import { RenamePlayerDialog } from "./rename-player-dialog.tsx";
import { RenameConversationDialog } from "./rename-conversation-dialog.tsx";
import { FeedbackPrompt } from "./feedback-prompt.tsx";

/**
 * Destructive and renaming dialogs, plus the one-time feedback ask.
 *
 * Each dialog renders open. Radix marks the story root `aria-hidden` while a
 * modal is open, so nothing focusable is rendered beside it — only static
 * text, which keeps the axe scan clean while still giving the root a child.
 */
const meta = {
  title: "Dialogs/Management",
  component: ConfirmDeleteDialog,
  tags: ["autodocs"],
} satisfies Meta<typeof ConfirmDeleteDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

const GUILD_ID = "1337623164146155593";

const CONVERSATION: ExploreConversation = ExploreConversationSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Ahri win rate by patch",
  shareToken: null,
  sharedLeafId: null,
  createdAt: "2026-08-14T12:00:00.000Z",
  updatedAt: "2026-08-14T12:30:00.000Z",
});

function noop(): void {
  // Story callbacks: no mutation runs against the catalog's transport.
}

function Backdrop(props: { readonly children: string }) {
  return <p className="text-sm text-scout-subtle">{props.children}</p>;
}

/**
 * The prompt is gated on a signed-in account that is at least a week old and
 * that the server still considers eligible, so both reads are seeded.
 */
const seedEligibleForFeedback: StorySeed = (trpc, queryClient) => {
  queryClient.setQueryData(
    trpc.auth.sessionState.queryOptions(undefined).queryKey,
    {
      user: {
        discordId: DiscordAccountIdSchema.parse("203094543069446145"),
        username: "faker",
        avatar: null,
        createdAt: "2026-01-04T09:00:00.000Z",
        analyticsUserId: "b6b9d8a0-1f2e-4c3b-9a11-5d6e7f809a1b",
      },
    },
  );
  queryClient.setQueryData(
    trpc.feedback.eligibility.queryOptions(undefined).queryKey,
    { shouldAsk: true },
  );
};

export const ConfirmDelete: Story = {
  args: {
    conversation: CONVERSATION,
    pending: false,
    error: null,
    onClose: noop,
    onConfirm: noop,
  },
  render: (args) => (
    <>
      <Backdrop>The conversation list sits behind this dialog.</Backdrop>
      <ConfirmDeleteDialog {...args} />
    </>
  ),
};

/** The server refused the delete; the dialog stays open and says why. */
export const ConfirmDeleteFailed: Story = {
  args: {
    conversation: CONVERSATION,
    pending: false,
    error: "This conversation is still streaming an answer. Stop it first.",
    onClose: noop,
    onConfirm: noop,
  },
  render: (args) => (
    <>
      <Backdrop>The conversation list sits behind this dialog.</Backdrop>
      <ConfirmDeleteDialog {...args} />
    </>
  ),
};

export const RenameConversation: Story = {
  args: {
    conversation: CONVERSATION,
    onClose: noop,
    onConfirm: noop,
  },
  render: () => (
    <>
      <Backdrop>
        Titles are derived from the opening question by default.
      </Backdrop>
      <RenameConversationDialog
        conversation={CONVERSATION}
        pending={false}
        error={null}
        onClose={noop}
        onRename={noop}
      />
    </>
  ),
};

export const RenamePlayer: Story = {
  args: {
    conversation: null,
    onClose: noop,
    onConfirm: noop,
  },
  render: () => (
    <>
      <Backdrop>Renaming a tracked player across the whole server.</Backdrop>
      <RenamePlayerDialog
        guildId={GUILD_ID}
        currentAlias="Hide on bush"
        open
        onOpenChange={noop}
        onRenamed={noop}
      />
    </>
  ),
};

/** Destructive: the source player is deleted once its accounts have moved. */
export const MergePlayers: Story = {
  args: {
    conversation: null,
    onClose: noop,
    onConfirm: noop,
  },
  render: () => (
    <>
      <Backdrop>
        Merging folds one player&apos;s accounts into another.
      </Backdrop>
      <MergePlayersDialog
        guildId={GUILD_ID}
        sourceAlias="Hide on bush"
        open
        onOpenChange={noop}
        onMerged={noop}
      />
    </>
  ),
};

/**
 * The corner chip the feedback ask starts as. Its dialog opens only from the
 * chip's own "Tell us" button, which the component owns — there is no prop to
 * render it open.
 */
export const FeedbackPromptChip: Story = {
  args: {
    conversation: null,
    onClose: noop,
    onConfirm: noop,
  },
  parameters: { seedQueries: [seedEligibleForFeedback] },
  render: () => (
    <>
      <Backdrop>Shown at most once per account, anywhere in the app.</Backdrop>
      <FeedbackPrompt />
    </>
  ),
};
