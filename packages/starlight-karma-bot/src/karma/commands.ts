import { Karma } from "../db/karma.ts";
import { KarmaCounts } from "../db/karma-counts.ts";
import { KarmaReceived } from "../db/karma-received.ts";
import { Person } from "../db/person.ts";
import { bold, type ChatInputCommandInteraction, inlineCode, SlashCommandBuilder, time, userMention } from "discord.js";
import { dataSource } from "../db/index.ts";
import _ from "lodash";
import client from "../discord/client.ts";

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
  if (!person) {
    console.log(`[Karma DB] Creating new person record for user ID: ${id}`);
    person = new Person();
    person.given = [];
    person.id = id;
    person.received = [];
    await dataSource.getRepository(Person).insert(person);
  }
  return person;
}

async function modifyKarma(giverId: string, receiverId: string, amount: number, guildId: string, reason?: string) {
  const giver = await getOrCreate(giverId);
  const receiver = await getOrCreate(receiverId);

  const karma = new Karma();
  karma.amount = amount;
  karma.datetime = new Date();
  karma.giver = giver;
  karma.reason = reason;
  karma.receiver = receiver;
  karma.guildId = guildId;

  console.log(
    `[Karma DB] Saving karma: ${giverId} -> ${receiverId}, amount: ${amount.toString()}, guild: ${guildId}${reason ? `, reason: "${reason}"` : ""}`,
  );
  await dataSource.manager.save(karma);
}

async function getKarma(id: string, guildId: string): Promise<number> {
  const karmaCounts = await dataSource.getRepository(KarmaCounts).findOneBy({
    id,
    guildId,
  });
  if (karmaCounts) {
    return karmaCounts.karmaReceived;
  } else {
    return 0;
  }
}

async function handleKarmaGive(interaction: ChatInputCommandInteraction) {
  const giverUser = interaction.user;
  const receiverUser = interaction.options.getUser("target", true);

  if (!interaction.guildId) {
    console.log(`[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted to give karma in DMs - rejected`);
    await interaction.reply({
      content: "Karma can only be given in a server, not in DMs.",
      ephemeral: true,
    });
    return;
  }

  if (receiverUser.bot) {
    console.log(
      `[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted to give karma to bot ${receiverUser.tag} (${receiverUser.id}) - rejected`,
    );
    await interaction.reply({
      content: `You can't give karma to ${userMention(receiverUser.id)} because they're a bot`,
      ephemeral: true,
    });
    return;
  }

  if (receiverUser.id === giverUser.id) {
    console.log(`[Karma Give] ${giverUser.tag} (${giverUser.id}) attempted self-karma - applying penalty (-1)`);
    await modifyKarma(giverUser.id, receiverUser.id, -1, interaction.guildId, "tried altering their own karma");
    const newKarma = await getKarma(receiverUser.id, interaction.guildId);
    console.log(
      `[Karma Give] Penalty applied to ${giverUser.tag} (${giverUser.id}), new karma: ${newKarma.toString()}`,
    );
    await interaction.reply({
      content: `${userMention(giverUser.id)} tried altering their karma. SMH my head. ${bold(
        "-1",
      )} karma. They now have ${bold(newKarma.toString())} karma.`,
    });
    return;
  }

  // eslint-disable-next-line no-restricted-syntax
  const reason = interaction.options.get("reason", false)?.value as unknown as string | undefined;
  console.log(
    `[Karma Give] ${giverUser.tag} (${giverUser.id}) giving karma to ${receiverUser.tag} (${receiverUser.id})${reason ? ` - reason: "${reason}"` : ""}`,
  );
  await modifyKarma(giverUser.id, receiverUser.id, 1, interaction.guildId, reason);
  const newReceiverKarma = await getKarma(receiverUser.id, interaction.guildId);
  console.log(
    `[Karma Give] Success! ${receiverUser.tag} (${receiverUser.id}) now has ${newReceiverKarma.toString()} karma`,
  );
  if (reason) {
    await interaction.reply(
      `${userMention(giverUser.id)} gave karma to ${userMention(
        receiverUser.id,
      )} because ${inlineCode(reason)}. They now have ${bold(newReceiverKarma.toString())} karma.`,
    );
  } else {
    await interaction.reply(
      `${userMention(giverUser.id)} gave karma to ${userMention(
        receiverUser.id,
      )}. They now have ${bold(newReceiverKarma.toString())} karma.`,
    );
  }
}

async function handleKarmaLeaderboard(interaction: ChatInputCommandInteraction) {
  console.log(`[Karma Leaderboard] ${interaction.user.tag} (${interaction.user.id}) requested leaderboard`);
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guildId) {
    console.log(`[Karma Leaderboard] Request from DMs - rejected`);
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

  console.log(
    `[Karma Leaderboard] Retrieved ${karmaCounts.length.toString()} entries for guild ${interaction.guildId}`,
  );

  let rank = 0;
  let prev: number;
  const leaderboard = (
    await Promise.all(
      _.map(karmaCounts, async (value) => {
        // show ties
        if (value.karmaReceived !== prev) {
          rank++;
        }
        // make a copy of rank. I think this is required because the function is async?
        const myRank = rank;
        prev = value.karmaReceived;

        // mention the user who called the leaderboard command
        let user = (await client.users.fetch(value.id, { cache: true })).username;
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
    )
  ).join("\n");
  console.log(`[Karma Leaderboard] Leaderboard generated and sent to ${interaction.user.tag} (${interaction.user.id})`);
  await interaction.editReply({
    content: `Karma Leaderboard:\n${leaderboard}`,
  });
}

async function handleKarmaHistory(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("target", true);
  console.log(
    `[Karma History] ${interaction.user.tag} (${interaction.user.id}) requested history for ${target.tag} (${target.id})`,
  );

  if (!interaction.guildId) {
    console.log(`[Karma History] Request from DMs - rejected`);
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

  console.log(
    `[Karma History] Retrieved ${karmaRecords.length.toString()} history records for ${target.tag} (${target.id}) in guild ${interaction.guildId}`,
  );

  if (karmaRecords.length === 0) {
    console.log(`[Karma History] No history found for ${target.tag} (${target.id})`);
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
        if (item.reason) {
          message += ` for ${inlineCode(item.reason)}`;
        }
        return message;
      }
      if (target.id === item.receiver.id) {
        let message = `${time(item.datetime)} Received ${bold(
          item.amount.toString(),
        )} karma from ${userMention(item.giver.id)}`;
        if (item.reason) {
          message += ` for ${inlineCode(item.reason)}`;
        }
        return message;
      }
      return "Unknown";
    })
    .join("\n");
  console.log(`[Karma History] History generated and sent to ${interaction.user.tag} (${interaction.user.id})`);
  await interaction.reply({
    content: `${userMention(target.id)}'s Karma History:\n${str}`,
    ephemeral: true,
  });
}

async function handleKarma(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  console.log(
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
