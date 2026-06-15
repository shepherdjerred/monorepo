import { MessageEmbed } from "discord.js";
import { CommentaryNotification } from "../notification";
import { DiscordNotification } from "./discordNotification";
import { Video } from "../../schema/schema";

export function convertVideo(video: Video): DiscordNotification {
  const embed = new MessageEmbed()
    .setTitle(video.title)
    .setURL(video.url)
    .setImage(video.thumbnail);
  return {
    embeds: [embed],
    content: "Skill capped released a new video!",
  };
}

export function convertCommentaries(
  _notification: CommentaryNotification,
): DiscordNotification[] {
  return [];
}
