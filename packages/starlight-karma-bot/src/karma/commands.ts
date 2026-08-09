import {
  bold,
  ChannelType,
  type ChatInputCommandInteraction,
  inlineCode,
  MessageFlags,
  PermissionFlagsBits,
  time,
  userMention,
} from "discord.js";
import { prisma } from "#src/db/index.ts";
import { karmaAmountFor, KARMA_GIVE_AMOUNT } from "#src/karma/scoring.ts";
import { handleKarmaLeaderboard } from "#src/karma/leaderboard.ts";
import {
  deleteKarmaById,
  findUndoableGive,
  getPairwiseExchange,
  getPersonStats,
  getRecentReasons,
  type ReasonRow,
  searchReasons,
} from "#src/karma/queries.ts";
import { getReceivedKarma, recordKarma } from "#src/karma/store.ts";
import {
  canEnableRecap,
  computeNextRecapAt,
  DEFAULT_RECAP_CRON,
  isValidCron,
} from "#src/karma/recap-schedule.ts";

/** How long after giving karma you can take it back. Long enough to catch a
 *  mis-click, short enough that it cannot be used to quietly rewrite history. */
const UNDO_WINDOW_MS = 5 * 60 * 1000;

/** Reject DMs, answering the user. Returns the guild id when in a guild. */
async function requireGuild(
  interaction: ChatInputCommandInteraction,
  what: string,
): Promise<string | null> {
  if (interaction.guildId !== null) {
    return interaction.guildId;
  }
  await interaction.reply({
    content: `${what} only works in a server, not in DMs.`,
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

/** A congratulations line when a give pushes someone past a threshold.
 *  Appended to the same reply rather than posted to a separate channel: it
 *  needs no configuration and lands where the moment actually happened. */
function milestoneSuffix(receiverId: string, milestone: number | null): string {
  return milestone === null
    ? ""
    : `\n\u{1F389} ${userMention(receiverId)} just passed ${bold(milestone.toString())} karma!`;
}

function formatReasonRow(row: ReasonRow): string {
  const who = `${userMention(row.giverId)} → ${userMention(row.receiverId)}`;
  const reason =
    row.reason === null || row.reason === ""
      ? "(no reason given)"
      : inlineCode(row.reason);
  return `${time(row.datetime, "R")} ${who} ${bold(row.amount.toString())} — ${reason}`;
}

async function handleKarmaGive(interaction: ChatInputCommandInteraction) {
  const giverUser = interaction.user;
  const receiverUser = interaction.options.getUser("target", true);

  const guildId = await requireGuild(interaction, "Giving karma");
  if (guildId === null) {
    return;
  }

  if (receiverUser.bot) {
    await interaction.reply({
      content: `You can't give karma to ${userMention(receiverUser.id)} because they're a bot`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const requested =
    interaction.options.getInteger("amount") ?? KARMA_GIVE_AMOUNT;

  if (receiverUser.id === giverUser.id) {
    // Self-gives cost the amount asked for: requesting 3 is a bigger stunt
    // than requesting 1, so it should sting proportionally.
    const penalty = karmaAmountFor(giverUser.id, receiverUser.id, requested);
    await recordKarma({
      giverId: giverUser.id,
      receiverId: receiverUser.id,
      amount: penalty,
      guildId,
      reason: "tried altering their own karma",
    });
    const newKarma = await getReceivedKarma(receiverUser.id, guildId);
    await interaction.reply({
      content: `${userMention(giverUser.id)} tried altering their karma. SMH my head. ${bold(
        penalty.toString(),
      )} karma. They now have ${bold(newKarma.toString())} karma.`,
    });
    return;
  }

  const reason = interaction.options.getString("reason") ?? undefined;
  const amount = karmaAmountFor(giverUser.id, receiverUser.id, requested);
  const totals = await recordKarma({
    giverId: giverUser.id,
    receiverId: receiverUser.id,
    amount,
    guildId,
    reason,
  });
  const newReceiverKarma = totals.receiverTotalAfter;
  const gave = `${userMention(giverUser.id)} gave ${bold(amount.toString())} karma to ${userMention(receiverUser.id)}`;
  const body =
    reason !== undefined && reason !== ""
      ? `${gave} because ${inlineCode(reason)}. They now have ${bold(newReceiverKarma.toString())} karma.`
      : `${gave}. They now have ${bold(newReceiverKarma.toString())} karma.`;
  await interaction.reply(
    `${body}${milestoneSuffix(receiverUser.id, totals.milestone)}`,
  );
}

async function handleKarmaCheck(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("target") ?? interaction.user;
  const guildId = await requireGuild(interaction, "Checking karma");
  if (guildId === null) {
    return;
  }

  const stats = await getPersonStats(guildId, target.id);
  const rank = stats.rank === null ? "unranked" : `#${stats.rank.toString()}`;
  await interaction.reply({
    content: `${userMention(target.id)} has ${bold(stats.received.toString())} karma (${rank}).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKarmaStats(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("target") ?? interaction.user;
  const guildId = await requireGuild(interaction, "Karma stats");
  if (guildId === null) {
    return;
  }

  const [stats, pairwise] = await Promise.all([
    getPersonStats(guildId, target.id),
    getPairwiseExchange(guildId, interaction.user.id, target.id),
  ]);

  const lines = [
    `${userMention(target.id)}'s karma`,
    `Received: ${bold(stats.received.toString())} across ${stats.entries.toString()} entries`,
    `Given: ${bold(stats.given.toString())}`,
    `Rank: ${stats.rank === null ? "unranked" : `#${stats.rank.toString()}`}`,
  ];
  if (stats.firstAt !== null) {
    lines.push(`First karma: ${time(stats.firstAt, "D")}`);
  }
  if (stats.biggestFan !== null) {
    lines.push(
      `Biggest fan: ${userMention(stats.biggestFan.id)} (${stats.biggestFan.total.toString()})`,
    );
  }
  if (target.id !== interaction.user.id) {
    lines.push(
      `Between you two: you gave ${bold(pairwise.viewerGave.toString())}, they gave ${bold(pairwise.otherGave.toString())}`,
    );
  }

  await interaction.reply({
    content: lines.join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKarmaWhy(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("target", true);
  const guildId = await requireGuild(interaction, "Karma reasons");
  if (guildId === null) {
    return;
  }

  const rows = await getRecentReasons(guildId, target.id);
  if (rows.length === 0) {
    await interaction.reply({
      content: `${userMention(target.id)} has no karma with a reason attached yet.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Why ${userMention(target.id)} has karma:\n${rows.map((row) => formatReasonRow(row)).join("\n")}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKarmaSearch(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true);
  const guildId = await requireGuild(interaction, "Karma search");
  if (guildId === null) {
    return;
  }

  const rows = await searchReasons(guildId, query);
  if (rows.length === 0) {
    await interaction.reply({
      content: `No karma reasons mention ${inlineCode(query)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Karma reasons mentioning ${inlineCode(query)}:\n${rows.map((row) => formatReasonRow(row)).join("\n")}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKarmaUndo(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction, "Undoing karma");
  if (guildId === null) {
    return;
  }

  const candidate = await findUndoableGive({
    guildId,
    giverId: interaction.user.id,
    withinMs: UNDO_WINDOW_MS,
  });

  if (candidate === null) {
    await interaction.reply({
      content: `You haven't given any karma in the last ${String(UNDO_WINDOW_MS / 60_000)} minutes.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await deleteKarmaById(candidate.id);
  const total = await getReceivedKarma(candidate.receiverId, guildId);
  await interaction.reply({
    content: `Took back ${bold(candidate.amount.toString())} karma from ${userMention(candidate.receiverId)}. They now have ${bold(total.toString())} karma.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function readRecapConfigOptions(
  interaction: ChatInputCommandInteraction,
) {
  const channel = interaction.options.getChannel("channel");
  const enabled = interaction.options.getBoolean("enabled");
  const cron = interaction.options.getString("cron");

  if (cron !== null && !isValidCron(cron)) {
    // Boundary input: answer the user instead of storing a schedule that
    // would silently never fire.
    await interaction.reply({
      content: `${inlineCode(cron)} is not a valid CRON expression.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  if (channel !== null && channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "The recap channel must be a text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return { channel, enabled, cron };
}

async function updateKarmaConfig(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const options = await readRecapConfigOptions(interaction);
  if (options === null) {
    return;
  }
  const { channel, enabled, cron } = options;

  const existing = await prisma.guildConfig.findUnique({ where: { guildId } });
  const nextChannelId = channel?.id ?? existing?.recapChannelId ?? null;
  const nextEnabled = enabled ?? existing?.enabled ?? false;
  if (!canEnableRecap(nextEnabled, nextChannelId)) {
    await interaction.reply({
      content: "Set a recap channel before enabling recaps.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nextCron = cron ?? existing?.recapCron ?? DEFAULT_RECAP_CRON;
  const data = {
    ...(channel === null ? {} : { recapChannelId: channel.id }),
    ...(enabled === null ? {} : { enabled }),
    recapCron: nextCron,
    // Recompute on every change so a new schedule takes effect immediately
    // rather than after the previously scheduled fire.
    nextRecapAt: computeNextRecapAt(nextCron, new Date()),
  };
  const config = await prisma.guildConfig.upsert({
    where: { guildId },
    create: { guildId, ...data },
    update: data,
  });

  await interaction.reply({
    content: [
      `Recap ${config.enabled ? "enabled" : "disabled"}.`,
      `Channel: ${config.recapChannelId === null ? "not set" : `<#${config.recapChannelId}>`}`,
      `Schedule: ${inlineCode(config.recapCron)} (UTC)`,
      config.nextRecapAt === null
        ? ""
        : `Next: ${time(config.nextRecapAt, "F")}`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKarmaConfig(interaction: ChatInputCommandInteraction) {
  const guildId = await requireGuild(interaction, "Karma config");
  if (guildId === null) {
    return;
  }
  if (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) !== true
  ) {
    await interaction.reply({
      content: "You need the Manage Server permission to change karma config.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await updateKarmaConfig(interaction, guildId);
}

async function handleKarmaHistory(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("target", true);
  const guildId = await requireGuild(interaction, "Karma history");
  if (guildId === null) {
    return;
  }

  const karmaRecords = await prisma.karma.findMany({
    where: {
      guildId,
      OR: [{ giverId: target.id }, { receiverId: target.id }],
    },
    orderBy: { datetime: "desc" },
    take: 10,
  });

  if (karmaRecords.length === 0) {
    await interaction.reply({
      content: `${userMention(target.id)} has no karma history in this server yet.`,
      flags: MessageFlags.Ephemeral,
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

  await interaction.reply({
    content: `${userMention(target.id)}'s Karma History:\n${str}`,
    flags: MessageFlags.Ephemeral,
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
    case "check":
      await handleKarmaCheck(interaction);
      break;
    case "stats":
      await handleKarmaStats(interaction);
      break;
    case "why":
      await handleKarmaWhy(interaction);
      break;
    case "search":
      await handleKarmaSearch(interaction);
      break;
    case "undo":
      await handleKarmaUndo(interaction);
      break;
    case "config":
      await handleKarmaConfig(interaction);
      break;
    case "history":
      await handleKarmaHistory(interaction);
      break;
    default:
      throw new Error(`Unhandled /karma subcommand: ${subcommand}`);
  }
}

export { handleKarma };
