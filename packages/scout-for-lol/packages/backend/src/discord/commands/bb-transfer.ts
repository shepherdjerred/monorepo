import {
  DiscordAccountIdSchema,
  formatInteger,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  transferBucks,
  type TransferBucksResult,
} from "#src/betting/transfer.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";

export type BbTransferCommandDependencies = {
  runTransfer?: typeof transferBucks;
  observeTransferReceipt?: typeof observeBucksDelivery;
};

function describeTransferFailure(result: TransferBucksResult): string {
  switch (result.kind) {
    case "feature_disabled":
      return "Bryan Bucks transfers are not enabled here.";
    case "invalid_amount":
      return "Transfer at least 2 whole BB.";
    case "same_user":
      return "You cannot transfer Bryan Bucks to yourself.";
    case "recipient_bot":
      return "Bots cannot receive Bryan Bucks transfers.";
    case "sender_not_found":
      return "You need an existing Bryan Bucks wallet before you can transfer.";
    case "recipient_not_found":
      return "That recipient needs an existing Bryan Bucks wallet first.";
    case "recipient_is_house":
      return "The house cannot receive a user transfer.";
    case "insufficient":
      return `You need ${formatInteger(result.needed)} BB for this transfer, but only ${formatInteger(result.balance)} BB are available.`;
    case "storage_limit":
      return "This transfer would exceed Bryan Bucks storage limits.";
    case "transferred":
      throw new Error("A completed transfer is not a failure");
  }
}

export function buildTransferReceipt(input: {
  senderDiscordId: DiscordAccountId;
  recipientDiscordId: DiscordAccountId;
  totalAmount: number;
  recipientAmount: number;
  feeAmount: number;
}): string {
  return (
    "💸 **Bryan Bucks Western Union**\n" +
    `<@${input.senderDiscordId}> spent **${formatInteger(input.totalAmount)} BB** to send ` +
    `<@${input.recipientDiscordId}> **${formatInteger(input.recipientAmount)} BB**. ` +
    `The house collected **${formatInteger(input.feeAmount)} BB**.`
  );
}

export async function replyBbTransfer(
  interaction: BbCommandInteraction,
  serverId: DiscordGuildId,
  senderDiscordId: DiscordAccountId,
  dependencies: BbTransferCommandDependencies = {},
): Promise<void> {
  const recipient = interaction.options.getUser("recipient", true);
  const recipientDiscordId = DiscordAccountIdSchema.parse(recipient.id);
  const amount = interaction.options.getInteger("amount", true);
  const result = await (dependencies.runTransfer ?? transferBucks)({
    serverId,
    senderDiscordId,
    recipientDiscordId,
    recipientIsBot: recipient.bot,
    amount,
  });
  if (result.kind !== "transferred") {
    await interaction.editReply({ content: describeTransferFailure(result) });
    return;
  }

  await interaction.editReply({
    content: `Transfer complete. ${formatInteger(result.recipientAmount)} BB went to <@${recipientDiscordId}> and ${formatInteger(result.feeAmount)} BB went to the house.`,
    allowedMentions: { parse: [] },
  });

  try {
    await (dependencies.observeTransferReceipt ?? observeBucksDelivery)(
      {
        surface: "transfer_receipt",
        operation: "send",
        serverId,
      },
      async () =>
        interaction.followUp({
          content: buildTransferReceipt({
            senderDiscordId,
            recipientDiscordId,
            totalAmount: result.totalAmount,
            recipientAmount: result.recipientAmount,
            feeAmount: result.feeAmount,
          }),
          allowedMentions: {
            parse: [],
            users: [senderDiscordId, recipientDiscordId],
            repliedUser: false,
          },
        }),
    );
  } catch {
    await interaction.editReply({
      content:
        "Transfer complete, but I could not post the public receipt. The transfer was not reversed; please do not retry it.",
    });
  }
}
