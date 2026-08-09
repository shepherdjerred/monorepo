import {
  bold,
  type ChatInputCommandInteraction,
  inlineCode,
  SlashCommandBuilder,
  time,
  userMention,
} from "discord.js";
import { prisma } from "#src/db/index.ts";
import client from "#src/discord/client.ts";
import {
  ALLOWED_KARMA_AMOUNTS,
  formatLeaderboardLine,
  karmaAmountFor,
  KARMA_GIVE_AMOUNT,
  rankLeaderboard,
} from "#src/karma/scoring.ts";
import { getReceivedKarma, recordKarma } from "#src/karma/store.ts";

/** Discord caps message content at 2000 characters; leave headroom so the
 *  truncation footer always fits. Production already renders 45 ranked entries
 *  at ~1420 characters, so this bound is close to binding today. */
const MAX_LEADERBOARD_CONTENT = 1900;

const karmaCommand = new SlashCommandBuilder()
  .setName("karma")
  .setDescription("Recognize positive contributions with karma points")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("give")
      .setDescription("Give karma to someone")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("The person you'd like to give karma to")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("An optional reason about why they deserve karma")
          .setMaxLength(200),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription(
            `How much karma to give (default ${String(KARMA_GIVE_AMOUNT)})`,
          )
          // A closed choice list, so Discord itself rejects anything else and
          // the amount cannot inflate. `scoring.ts` re-validates because the
          // context menu and any future surface do not get this for free.
          .addChoices(
            ...ALLOWED_KARMA_AMOUNTS.map((amount) => ({
              name: String(amount),
              value: amount,
            })),
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("leaderboard")
      .setDescription("See karma values for everyone on the server"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("history")
      .setDescription("View recent changes to a person's karma")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("The person whose karma history you'd like to view")
          .setRequired(true),
      ),
  );

async function handleKarmaGive(interaction: ChatInputCommandInteraction) {
  const giverUser = interaction.user;
  const receiverUser = interaction.options.getUser("target", true);

  if (interaction.guildId === null) {
    console.warn(
      `[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted to give karma in DMs - rejected`,
    );
    await interaction.reply({
      content: "Karma can only be given in a server, not in DMs.",
      ephemeral: true,
    });
    return;
  }

  if (receiverUser.bot) {
    console.warn(
      `[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted to give karma to bot ${receiverUser.tag} (${receiverUser.id}) - rejected`,
    );
    await interaction.reply({
      content: `You can't give karma to ${userMention(receiverUser.id)} because they're a bot`,
      ephemeral: true,
    });
    return;
  }

  const requested =
    interaction.options.getInteger("amount") ?? KARMA_GIVE_AMOUNT;

  if (receiverUser.id === giverUser.id) {
    // Self-gives cost the amount asked for: requesting 3 is a bigger stunt
    // than requesting 1, so it should sting proportionally.
    const penalty = karmaAmountFor(giverUser.id, receiverUser.id, requested);
    console.warn(
      `[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted self-karma - applying penalty (${penalty.toString()})`,
    );
    await recordKarma({
      giverId: giverUser.id,
      receiverId: receiverUser.id,
      amount: penalty,
      guildId: interaction.guildId,
      reason: "tried altering their own karma",
    });
    const newKarma = await getReceivedKarma(
      receiverUser.id,
      interaction.guildId,
    );
    console.warn(
      `[Karma Give] Penalty applied to ${giverUser.tag} (${giverUser.id}), new karma: ${newKarma.toString()}`,
    );
    await interaction.reply({
      content: `${userMention(giverUser.id)} tried altering their karma. SMH my head. ${bold(
        penalty.toString(),
      )} karma. They now have ${bold(newKarma.toString())} karma.`,
    });
    return;
  }

  const reason = interaction.options.getString("reason") ?? undefined;
  const amount = karmaAmountFor(giverUser.id, receiverUser.id, requested);
  console.warn(
    `[Karma Give] ${giverUser.tag} (${giverUser.id}) giving ${amount.toString()} karma to ${receiverUser.tag} (${receiverUser.id})${reason !== undefined && reason !== "" ? ` - reason: "${reason}"` : ""}`,
  );
  await recordKarma({
    giverId: giverUser.id,
    receiverId: receiverUser.id,
    amount,
    guildId: interaction.guildId,
    reason,
  });
  const newReceiverKarma = await getReceivedKarma(
    receiverUser.id,
    interaction.guildId,
  );
  console.warn(
    `[Karma Give] Success! ${receiverUser.tag} (${receiverUser.id}) now has ${newReceiverKarma.toString()} karma`,
  );
  const gave = `${userMention(giverUser.id)} gave ${bold(amount.toString())} karma to ${userMention(receiverUser.id)}`;
  await interaction.reply(
    reason !== undefined && reason !== ""
      ? `${gave} because ${inlineCode(reason)}. They now have ${bold(newReceiverKarma.toString())} karma.`
      : `${gave}. They now have ${bold(newReceiverKarma.toString())} karma.`,
  );
}

async function handleKarmaLeaderboard(
  interaction: ChatInputCommandInteraction,
) {
  console.warn(
    `[Karma Leaderboard] ${interaction.user.tag} (${interaction.user.id}) requested leaderboard`,
  );
  await interaction.deferReply({ ephemeral: true });

  if (interaction.guildId === null) {
    console.warn(`[Karma Leaderboard] Request from DMs - rejected`);
    await interaction.editReply({
      content: "Karma leaderboard can only be viewed in a server, not in DMs.",
    });
    return;
  }

  const totals = await prisma.karma.groupBy({
    by: ["receiverId"],
    where: { guildId: interaction.guildId },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
  });

  console.warn(
    `[Karma Leaderboard] Retrieved ${totals.length.toString()} entries for guild ${interaction.guildId}`,
  );

  const ranked = rankLeaderboard(
    totals.map((row) => ({
      id: row.receiverId,
      karmaReceived: row._sum.amount ?? 0,
    })),
  );

  // Accumulate against a character budget rather than rendering every entry:
  // the full board is already at ~71% of Discord's limit, and long usernames
  // would push it over. Resolving names lazily also avoids fetching users we
  // are not going to show.
  const header = "Karma Leaderboard:";
  const lines: string[] = [];
  let used = header.length;

  for (const entry of ranked) {
    const fetchedUser = await client.users.fetch(entry.id, { cache: true });
    const displayName =
      interaction.user.id === entry.id
        ? userMention(interaction.user.id)
        : fetchedUser.username;
    const line = formatLeaderboardLine(entry, displayName);

    // Reserve room for the truncation footer only when one would actually be
    // needed — i.e. when this is not the last entry. Reserving unconditionally
    // dropped entries from boards that would have fit whole.
    const remaining = ranked.length - lines.length;
    const isLast = remaining === 1;
    const footerCost = isLast
      ? 0
      : `\n…and ${remaining.toString()} more`.length;
    if (used + 1 + line.length + footerCost > MAX_LEADERBOARD_CONTENT) {
      lines.push(`…and ${remaining.toString()} more`);
      break;
    }
    used += 1 + line.length;
    lines.push(line);
  }

  console.warn(
    `[Karma Leaderboard] Leaderboard generated and sent to ${interaction.user.tag} (${interaction.user.id})`,
  );
  await interaction.editReply({
    content: `${header}\n${lines.join("\n")}`,
  });
}

async function handleKarmaHistory(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("target", true);
  console.warn(
    `[Karma History] ${interaction.user.tag} (${interaction.user.id}) requested history for ${target.tag} (${target.id})`,
  );

  if (interaction.guildId === null) {
    console.warn(`[Karma History] Request from DMs - rejected`);
    await interaction.reply({
      content: "Karma history can only be viewed in a server, not in DMs.",
      ephemeral: true,
    });
    return;
  }

  const karmaRecords = await prisma.karma.findMany({
    where: {
      guildId: interaction.guildId,
      OR: [{ giverId: target.id }, { receiverId: target.id }],
    },
    orderBy: { datetime: "desc" },
    take: 10,
  });

  console.warn(
    `[Karma History] Retrieved ${karmaRecords.length.toString()} history records for ${target.tag} (${target.id}) in guild ${interaction.guildId}`,
  );

  if (karmaRecords.length === 0) {
    console.warn(
      `[Karma History] No history found for ${target.tag} (${target.id})`,
    );
    await interaction.reply({
      content: `${userMention(target.id)} has no karma history in this server yet.`,
      ephemeral: true,
    });
    return;
  }

  const str = karmaRecords
    .map((item) => {
      const gave = item.giverId === target.id;
      const counterparty = gave ? item.receiverId : item.giverId;
      let message = `${time(item.datetime)} ${gave ? "Gave" : "Received"} ${bold(
        item.amount.toString(),
      )} karma ${gave ? "to" : "from"} ${userMention(counterparty)}`;
      if (item.reason !== null && item.reason !== "") {
        message += ` for ${inlineCode(item.reason)}`;
      }
      return message;
    })
    .join("\n");
  console.warn(
    `[Karma History] History generated and sent to ${interaction.user.tag} (${interaction.user.id})`,
  );
  await interaction.reply({
    content: `${userMention(target.id)}'s Karma History:\n${str}`,
    ephemeral: true,
  });
}

async function handleKarma(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  console.warn(
    `[Karma] User ${interaction.user.tag} (${interaction.user.id}) executed subcommand: /karma ${subcommand}`,
  );
  switch (subcommand) {
    case "give":
      await handleKarmaGive(interaction);
      break;
    case "leaderboard":
      await handleKarmaLeaderboard(interaction);
      break;
    case "history":
      await handleKarmaHistory(interaction);
      break;
    default:
      throw new Error("unreachable");
  }
}

export { handleKarma, karmaCommand };
