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
  formatLeaderboardLine,
  karmaAmountFor,
  rankLeaderboard,
} from "#src/karma/scoring.ts";

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

/** Ensure a `person` row exists so the karma foreign keys resolve. */
async function ensurePerson(id: string): Promise<void> {
  await prisma.person.upsert({
    where: { id },
    create: { id },
    update: {},
  });
}

async function modifyKarma(params: {
  giverId: string;
  receiverId: string;
  amount: number;
  guildId: string;
  reason?: string | undefined;
}) {
  await ensurePerson(params.giverId);
  if (params.receiverId !== params.giverId) {
    await ensurePerson(params.receiverId);
  }

  console.warn(
    `[Karma DB] Saving karma: ${params.giverId} -> ${params.receiverId}, amount: ${params.amount.toString()}, guild: ${params.guildId}${params.reason !== undefined && params.reason !== "" ? `, reason: "${params.reason}"` : ""}`,
  );
  await prisma.karma.create({
    data: {
      amount: params.amount,
      datetime: new Date(),
      reason: params.reason ?? null,
      guildId: params.guildId,
      giverId: params.giverId,
      receiverId: params.receiverId,
    },
  });
}

async function getKarma(id: string, guildId: string): Promise<number> {
  const { _sum } = await prisma.karma.aggregate({
    _sum: { amount: true },
    where: { receiverId: id, guildId },
  });
  return _sum.amount ?? 0;
}

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

  if (receiverUser.id === giverUser.id) {
    console.warn(
      `[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted self-karma - applying penalty (-1)`,
    );
    const penalty = karmaAmountFor(giverUser.id, receiverUser.id);
    await modifyKarma({
      giverId: giverUser.id,
      receiverId: receiverUser.id,
      amount: penalty,
      guildId: interaction.guildId,
      reason: "tried altering their own karma",
    });
    const newKarma = await getKarma(receiverUser.id, interaction.guildId);
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
  console.warn(
    `[Karma Give] ${giverUser.tag} (${giverUser.id}) giving karma to ${receiverUser.tag} (${receiverUser.id})${reason !== undefined && reason !== "" ? ` - reason: "${reason}"` : ""}`,
  );
  await modifyKarma({
    giverId: giverUser.id,
    receiverId: receiverUser.id,
    amount: karmaAmountFor(giverUser.id, receiverUser.id),
    guildId: interaction.guildId,
    reason,
  });
  const newReceiverKarma = await getKarma(receiverUser.id, interaction.guildId);
  console.warn(
    `[Karma Give] Success! ${receiverUser.tag} (${receiverUser.id}) now has ${newReceiverKarma.toString()} karma`,
  );
  await interaction.reply(
    reason !== undefined && reason !== ""
      ? `${userMention(giverUser.id)} gave karma to ${userMention(
          receiverUser.id,
        )} because ${inlineCode(reason)}. They now have ${bold(newReceiverKarma.toString())} karma.`
      : `${userMention(giverUser.id)} gave karma to ${userMention(
          receiverUser.id,
        )}. They now have ${bold(newReceiverKarma.toString())} karma.`,
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

    const remaining = ranked.length - lines.length;
    const footer = `\n…and ${remaining.toString()} more`;
    if (used + 1 + line.length + footer.length > MAX_LEADERBOARD_CONTENT) {
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
