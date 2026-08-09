/** "Apps → Give Karma" on any message.
 *
 *  Complements react-to-give: the reaction is the one-tap path, this is the
 *  path that lets you say *why* and pick an amount. Needs no gateway intent. */
import {
  ApplicationCommandType,
  bold,
  ContextMenuCommandBuilder,
  inlineCode,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
  ModalBuilder,
  TextInputStyle,
  userMention,
} from "discord.js";
import {
  ALLOWED_KARMA_AMOUNTS,
  InvalidKarmaAmountError,
  karmaAmountFor,
  KARMA_GIVE_AMOUNT,
} from "#src/karma/scoring.ts";
import { decodeModalId, encodeModalId } from "#src/karma/rules.ts";
import { getReceivedKarma, recordKarma } from "#src/karma/store.ts";

export const GIVE_KARMA_CONTEXT_COMMAND = "Give Karma";

const REASON_INPUT = "reason";
const AMOUNT_INPUT = "amount";

export const giveKarmaContextCommand = new ContextMenuCommandBuilder()
  .setName(GIVE_KARMA_CONTEXT_COMMAND)
  .setType(ApplicationCommandType.Message);

export async function handleGiveKarmaContext(
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> {
  const { targetMessage } = interaction;

  if (interaction.guildId === null) {
    await interaction.reply({
      content: "Karma can only be given in a server, not in DMs.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (targetMessage.author.bot) {
    await interaction.reply({
      content: `You can't give karma to ${userMention(targetMessage.author.id)} because they're a bot`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Built with the label-component API rather than action rows; the action-row
  // form is deprecated. `addLabelComponents` takes a callback, so `LabelBuilder`
  // does not need to be imported (discord.js does not re-export it).
  const modal = new ModalBuilder()
    .setCustomId(encodeModalId(targetMessage.id, targetMessage.author.id))
    .setTitle("Give Karma")
    .addLabelComponents(
      (label) =>
        label
          .setLabel("Why do they deserve it?")
          .setTextInputComponent((input) =>
            input
              .setCustomId(REASON_INPUT)
              .setStyle(TextInputStyle.Short)
              .setMaxLength(200)
              .setRequired(false),
          ),
      (label) =>
        label.setLabel("How much?").setStringSelectMenuComponent((select) =>
          select
            .setCustomId(AMOUNT_INPUT)
            .setRequired(false)
            .setOptions(
              ALLOWED_KARMA_AMOUNTS.map((amount) => ({
                label: String(amount),
                value: String(amount),
                default: amount === KARMA_GIVE_AMOUNT,
              })),
            ),
        ),
    );

  await interaction.showModal(modal);
}

export async function handleGiveKarmaModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const target = decodeModalId(interaction.customId);
  if (target === null || interaction.guildId === null) {
    return;
  }

  const giverId = interaction.user.id;
  const reasonRaw = interaction.fields.getTextInputValue(REASON_INPUT).trim();
  const reason = reasonRaw === "" ? undefined : reasonRaw;
  const [selected] = interaction.fields.getStringSelectValues(AMOUNT_INPUT);

  let amount: number;
  try {
    amount = karmaAmountFor(
      giverId,
      target.authorId,
      selected ?? KARMA_GIVE_AMOUNT,
    );
  } catch (error) {
    if (error instanceof InvalidKarmaAmountError) {
      // Boundary input, not a broken contract: answer the user rather than
      // reporting it to Sentry.
      await interaction.reply({
        content: `Karma amount must be one of ${ALLOWED_KARMA_AMOUNTS.join(", ")}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw error;
  }

  await recordKarma({
    giverId,
    receiverId: target.authorId,
    amount,
    guildId: interaction.guildId,
    reason,
    sourceMessageId: target.messageId,
  });

  const total = await getReceivedKarma(target.authorId, interaction.guildId);
  const headline =
    giverId === target.authorId
      ? `${userMention(giverId)} tried altering their karma. SMH my head. ${bold(amount.toString())} karma.`
      : `${userMention(giverId)} gave ${bold(amount.toString())} karma to ${userMention(target.authorId)}${reason === undefined ? "" : ` because ${inlineCode(reason)}`}.`;

  await interaction.reply({
    content: `${headline} They now have ${bold(total.toString())} karma.`,
  });
}
