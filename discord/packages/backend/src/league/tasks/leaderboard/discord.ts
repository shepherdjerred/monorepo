import { bold, userMention } from "npm:discord.js@14.14.1";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import {
  Leaderboard,
  LeaderboardEntry,
  PlayerConfigEntry,
  rankToString,
} from "@discord/data";
import configuration from "../../../configuration.ts";
import client from "../../../discord/client.ts";

export function leaderboardToDiscordMessage(leaderboard: Leaderboard): string {
  return _.chain(leaderboard.contents)
    .map(leaderboardEntryToDiscordMessage)
    .join("\n")
    .value();
}

function leaderboardEntryToDiscordMessage({
  position,
  player,
}: LeaderboardEntry): string {
  let positionString = `#${position.toString()}`;
  // top 3 are better than everyone else
  if (position <= 3) {
    positionString = bold(positionString);
  }

  return `${positionString}: ${userMention(
    player.config.discordAccount.id
  )} ${bold(rankToString(player.ranks.solo))}`;
}

export async function setKing(king: PlayerConfigEntry) {
  const guild = await client.guilds.fetch(configuration.guildId);
  const role = await guild.roles.fetch(configuration.leaderboardRoleId);
  if (role === null) {
    throw new Error("unable to find role");
  }
  await Promise.all(role.members.map((member) => member.roles.remove(role)));
  const kingMember = await guild.members.fetch(king.discordAccount.id);
  await kingMember.roles.add(role);
}
