import {
  Karma,
  KarmaCounts,
  KarmaReceived,
  Person,
} from "../db/karma/index.ts";
import {
  bold,
  type ChatInputCommandInteraction,
  CommandInteraction,
  inlineCode,
  SlashCommandBuilder,
  time,
  userMention,
} from "npm:discord.js@14.14.1";
import { dataSource } from "../db/index.ts";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import client from "../discord/client.ts";

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

async function getOrCreate(id: string): Promise<Person> {
  let person = await dataSource.getRepository(Person).findOne({
    where: {
      id,
    },
    relations: [
      "received",
      "given",
      "given.receiver",
      "given.giver",
      "received.receiver",
      "received.giver",
    ],
  });
  if (!person) {
    person = new Person();
    person.given = [];
    person.id = id;
    person.received = [];
    await dataSource.getRepository(Person).insert(person);
  }
  return person;
}

async function modifyKarma(
  giverId: string,
  receiverId: string,
  amount: number,
  reason?: string,
) {
  const giver = await getOrCreate(giverId);
  const receiver = await getOrCreate(receiverId);

  const karma = new Karma();
  karma.amount = amount;
  karma.datetime = new Date();
  karma.giver = giver;
  karma.reason = reason;
  karma.receiver = receiver;

  await dataSource.manager.save(karma);
}

async function getKarma(id: string): Promise<number> {
  const karmaCounts = await dataSource.getRepository(KarmaCounts).findOneBy({
    id,
  });
  if (karmaCounts) {
    return karmaCounts.karmaReceived;
  } else {
    return 0;
  }
}

async function handleKarmaGive(interaction: CommandInteraction) {
  const giverUser = interaction.user;
  const receiverUser = interaction.options.getUser("target", true);

  if (receiverUser.bot) {
    await interaction.reply({
      content: `You can't give karma to ${userMention(
        receiverUser.id,
      )} because they're a bot`,
      ephemeral: true,
    });
    return;
  }

  if (receiverUser.id === giverUser.id) {
    await modifyKarma(
      giverUser.id,
      receiverUser.id,
      -1,
      "tried altering their own karma",
    );
    const newKarma = await getKarma(receiverUser.id);
    await interaction.reply({
      content: `${userMention(
        giverUser.id,
      )} tried altering their karma. SMH my head. ${bold(
        "-1",
      )} karma. They now have ${bold(newKarma.toString())} karma.`,
    });
    return;
  }

  const reason = interaction.options.get("reason", false)?.value as
    | string
    | undefined;
  await modifyKarma(giverUser.id, receiverUser.id, 1, reason);
  const newReceiverKarma = await getKarma(receiverUser.id);
  if (reason) {
    await interaction.reply(
      `${userMention(giverUser.id)} gave karma to ${userMention(
        receiverUser.id,
      )} because ${inlineCode(reason)}. They now have ${bold(
        newReceiverKarma.toString(),
      )} karma.`,
    );
  } else {
    await interaction.reply(
      `${userMention(giverUser.id)} gave karma to ${userMention(
        receiverUser.id,
      )}. They now have ${bold(newReceiverKarma.toString())} karma.`,
    );
  }
}

async function handleKarmaLeaderboard(interaction: CommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const karmaCounts = await dataSource.getRepository(KarmaReceived).find({
    select: {
      id: true,
      karmaReceived: true,
    },
  });

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
        let user = (await client.users.fetch(value.id, { cache: true }))
          .username;
        if (interaction.user.id === value.id) {
          user = userMention(interaction.user.id);
        }

        let rankString = `#${myRank.toString()}`;
        // top 3 are better than everyone else
        if (myRank <= 3) {
          rankString = bold(rankString);
        }

        return `${rankString}: ${user} (${value.karmaReceived} karma)`;
      }),
    )
  ).join("\n");
  await interaction.editReply({
    content: `Karma Leaderboard:\n${leaderboard}`,
  });
}

async function handleKarmaHistory(interaction: CommandInteraction) {
  const target = interaction.options.getUser("target", true);
  const person = await getOrCreate(target.id);
  const str = [...person.given, ...person.received]
    .sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
    .reverse()
    .slice(0, 10)
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
  await interaction.reply({
    content: `${userMention(target.id)}'s Karma History:\n${str}`,
    ephemeral: true,
  });
}

async function handleKarma(interaction: ChatInputCommandInteraction) {
  switch (interaction.options.getSubcommand()) {
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
