import { Karma } from "#src/db/karma.ts";
import { KarmaCounts } from "#src/db/karma-counts.ts";
import { KarmaReceived } from "#src/db/karma-received.ts";
import { Person } from "#src/db/person.ts";
import { bold, type ChatInputCommandInteraction, inlineCode, SlashCommandBuilder, time, userMention } from "discord.js";
import { dataSource } from "#src/db/index.ts";
import _ from "lodash";
import client from "#src/discord/client.ts";

const karmaCommand = new SlashCommandBuilder()
  .setName("karma")
  .setDescription("Recognize positive contributions with karma points")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("give")
      .setDescription("Give karma to someone")
      .addUserOption((option) =>
        option.setName("target").setDescription("The person you'd like to give karma to").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("An optional reason about why they deserve karma").setMaxLength(200),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("leaderboard").setDescription("See karma values for everyone on the server"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("history")
      .setDescription("View recent changes to a person's karma")
      .addUserOption((option) =>
        option.setName("target").setDescription("The person whose karma history you'd like to view").setRequired(true),
      ),
  );

async function getOrCreate(id: string): Promise<Person> {
  let person = await dataSource.getRepository(Person).findOne({
    where: {
      id,
    },
    relations: ["received", "given", "given.receiver", "given.giver", "received.receiver", "received.giver"],
  });
  if (person === null) {
    console.warn(`[Karma DB] Creating new person record for user ID: ${id}`);
    person = new Person();
    person.given = [];
    person.id = id;
    person.received = [];
    await dataSource.getRepository(Person).insert(person);
  }
  return person;
}

async function modifyKarma(params: {
  giverId: string;
  receiverId: string;
  amount: number;
  guildId: string;
  reason?: string;
}) {
  const giver = await getOrCreate(params.giverId);
  const receiver = await getOrCreate(params.receiverId);

  const karma = new Karma();
  karma.amount = params.amount;
  karma.datetime = new Date();
  karma.giver = giver;
  karma.reason = params.reason;
  karma.receiver = receiver;
  karma.guildId = params.guildId;

  console.warn(
    `[Karma DB] Saving karma: ${params.giverId} -> ${params.receiverId}, amount: ${params.amount.toString()}, guild: ${params.guildId}${params.reason !== undefined && params.reason !== "" ? `, reason: "${params.reason}"` : ""}`,
  );
  await dataSource.manager.save(karma);
}

async function getKarma(id: string, guildId: string): Promise<number> {
  const karmaCounts = await dataSource.getRepository(KarmaCounts).findOneBy({
    id,
    guildId,
  });
  return karmaCounts === null ? 0 : karmaCounts.karmaReceived;
}

async function handleKarmaGive(interaction: ChatInputCommandInteraction) {
  const giverUser = interaction.user;
  const receiverUser = interaction.options.getUser("target", true);

  if (interaction.guildId === null) {
    console.warn(`[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted to give karma in DMs - rejected`);
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
    console.warn(`[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted self-karma - applying penalty (-1)`);
    await modifyKarma({ giverId: giverUser.id, receiverId: receiverUser.id, amount: -1, guildId: interaction.guildId, reason: "tried altering their own karma" });
    const newKarma = await getKarma(receiverUser.id, interaction.guildId);
    console.warn(
      `[Karma Give] Penalty applied to ${giverUser.tag} (${giverUser.id}), new karma: ${newKarma.toString()}`,
    );
    await interaction.reply({
      content: `${userMention(giverUser.id)} tried altering their karma. SMH my head. ${bold(
        "-1",
      )} karma. They now have ${bold(newKarma.toString())} karma.`,
    });
    return;
  }

  const reasonValue = interaction.options.get("reason", false)?.value;
  const reason = typeof reasonValue === "string" ? reasonValue : undefined;
  console.warn(
    `[Karma Give] ${giverUser.tag} (${giverUser.id}) giving karma to ${receiverUser.tag} (${receiverUser.id})${reason !== undefined && reason !== "" ? ` - reason: "${reason}"` : ""}`,
  );
  await modifyKarma({ giverId: giverUser.id, receiverId: receiverUser.id, amount: 1, guildId: interaction.guildId, reason });
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

async function handleKarmaLeaderboard(interaction: ChatInputCommandInteraction) {
  console.warn(`[Karma Leaderboard] ${interaction.user.tag} (${interaction.user.id}) requested leaderboard`);
  await interaction.deferReply({ ephemeral: true });

  if (interaction.guildId === null) {
    console.warn(`[Karma Leaderboard] Request from DMs - rejected`);
    await interaction.editReply({
      content: "Karma leaderboard can only be viewed in a server, not in DMs.",
    });
    return;
  }

  const karmaCounts = await dataSource.getRepository(KarmaReceived).find({
    select: {
      id: true,
      karmaReceived: true,
    },
    where: {
      guildId: interaction.guildId,
    },
  });

  console.warn(
    `[Karma Leaderboard] Retrieved ${karmaCounts.length.toString()} entries for guild ${interaction.guildId}`,
  );

  let rank = 0;
  let prev: number;
  const leaderboardEntries = await Promise.all(
    _.map(karmaCounts, async (value) => {
      // show ties
      if (value.karmaReceived !== prev) {
        rank++;
      }
      // make a copy of rank. I think this is required because the function is async?
      const myRank = rank;
      prev = value.karmaReceived;

      // mention the user who called the leaderboard command
      const fetchedUser = await client.users.fetch(value.id, { cache: true });
      let user = fetchedUser.username;
      if (interaction.user.id === value.id) {
        user = userMention(interaction.user.id);
      }

      let rankString = `#${myRank.toString()}`;
      // top 3 are better than everyone else
      if (myRank <= 3) {
        rankString = bold(rankString);
      }

      return `${rankString}: ${user} (${String(value.karmaReceived)} karma)`;
    }),
  );
  const leaderboard = leaderboardEntries.join("\n");
  console.warn(`[Karma Leaderboard] Leaderboard generated and sent to ${interaction.user.tag} (${interaction.user.id})`);
  await interaction.editReply({
    content: `Karma Leaderboard:\n${leaderboard}`,
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

  await getOrCreate(target.id);

  // Fetch karma records for this user in this guild
  // Note: guildId can be null for legacy data from before multi-server support
  const karmaRecords = await dataSource.getRepository(Karma).find({
    where: [
      { giver: { id: target.id }, guildId: interaction.guildId },
      { receiver: { id: target.id }, guildId: interaction.guildId },
    ],
    relations: ["giver", "receiver"],
    order: { datetime: "DESC" },
    take: 10,
  });

  console.warn(
    `[Karma History] Retrieved ${karmaRecords.length.toString()} history records for ${target.tag} (${target.id}) in guild ${interaction.guildId}`,
  );

  if (karmaRecords.length === 0) {
    console.warn(`[Karma History] No history found for ${target.tag} (${target.id})`);
    await interaction.reply({
      content: `${userMention(target.id)} has no karma history in this server yet.`,
      ephemeral: true,
    });
    return;
  }

  const str = karmaRecords
    .map((item) => {
      if (target.id === item.giver.id) {
        let message = `${time(item.datetime)} Gave ${bold(
          item.amount.toString(),
        )} karma to ${userMention(item.receiver.id)}`;
        if (item.reason !== undefined && item.reason !== "") {
          message += ` for ${inlineCode(item.reason)}`;
        }
        return message;
      }
      if (target.id === item.receiver.id) {
        let message = `${time(item.datetime)} Received ${bold(
          item.amount.toString(),
        )} karma from ${userMention(item.giver.id)}`;
        if (item.reason !== undefined && item.reason !== "") {
          message += ` for ${inlineCode(item.reason)}`;
        }
        return message;
      }
      return "Unknown";
    })
    .join("\n");
  console.warn(`[Karma History] History generated and sent to ${interaction.user.tag} (${interaction.user.id})`);
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
