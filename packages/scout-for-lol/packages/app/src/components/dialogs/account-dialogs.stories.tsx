import type { Meta, StoryObj } from "@storybook/react-vite";
import { AddAccountDialog } from "./add-account-dialog.tsx";
import { EditAccountDialog } from "./edit-account-dialog.tsx";
import { TransferAccountDialog } from "./transfer-account-dialog.tsx";
import { LinkDiscordDialog } from "./link-discord-dialog.tsx";

/**
 * The four dialogs that manage a player's Riot accounts and Discord identity.
 *
 * Every story renders its dialog open. Radix marks the story root
 * `aria-hidden` while a modal is open, so the only thing beside each dialog is
 * static text — a focusable control out there would be unreachable and fail
 * the axe scan.
 *
 * Each typeahead inside is a combobox whose search is disabled until something
 * is typed, so the dialogs mount without a single request.
 */
const meta = {
  title: "Dialogs/Accounts",
  component: AddAccountDialog,
  tags: ["autodocs"],
} satisfies Meta<typeof AddAccountDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

const GUILD_ID = "1337623164146155593";

function noop(): void {
  // Story callbacks: no mutation runs against the catalog's transport.
}

function Backdrop(props: { readonly children: string }) {
  return <p className="text-sm text-scout-subtle">{props.children}</p>;
}

export const AddAccount: Story = {
  args: {
    guildId: GUILD_ID,
    playerAlias: "Hide on bush",
    open: true,
    onOpenChange: noop,
    onAdded: noop,
  },
  render: (args) => (
    <>
      <Backdrop>
        The player&apos;s account list sits behind this dialog.
      </Backdrop>
      <AddAccountDialog {...args} />
    </>
  ),
};

export const EditAccount: Story = {
  args: {
    guildId: GUILD_ID,
    playerAlias: "unused",
    open: true,
    onOpenChange: noop,
    onAdded: noop,
  },
  render: () => (
    <>
      <Backdrop>
        Editing an account renames it and re-resolves its region.
      </Backdrop>
      <EditAccountDialog
        guildId={GUILD_ID}
        account={{ id: 412, alias: "Hide on bush", region: "KOREA" }}
        open
        onOpenChange={noop}
        onSaved={noop}
      />
    </>
  ),
};

export const TransferAccount: Story = {
  args: {
    guildId: GUILD_ID,
    playerAlias: "unused",
    open: true,
    onOpenChange: noop,
    onAdded: noop,
  },
  render: () => (
    <>
      <Backdrop>Moving one Riot account from its player to another.</Backdrop>
      <TransferAccountDialog
        guildId={GUILD_ID}
        account={{ riotId: "Hide on bush#KR1", region: "KOREA" }}
        open
        onOpenChange={noop}
        onTransferred={noop}
      />
    </>
  ),
};

export const LinkDiscord: Story = {
  args: {
    guildId: GUILD_ID,
    playerAlias: "unused",
    open: true,
    onOpenChange: noop,
    onAdded: noop,
  },
  render: () => (
    <>
      <Backdrop>Binding a Discord member to a tracked player.</Backdrop>
      <LinkDiscordDialog
        guildId={GUILD_ID}
        playerAlias="Hide on bush"
        open
        onOpenChange={noop}
        onLinked={noop}
      />
    </>
  ),
};
