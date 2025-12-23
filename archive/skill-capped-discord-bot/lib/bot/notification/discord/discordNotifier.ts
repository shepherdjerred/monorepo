import { Client, Intents, TextChannel } from "discord.js";
import {
  CommentaryNotification,
  Notifier,
  VideoNotification,
} from "../notification";
import { convertVideo } from "./discordNotificationCreator";

export class DiscordNotifier implements Notifier {
  readonly discordToken: string;
  readonly discordChannel: string;
  constructor(discordToken: string, discordChannel: string) {
    this.discordToken = discordToken;
    this.discordChannel = discordChannel;
  }

  async notifyCommentaries(
    _notification: CommentaryNotification
  ): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  async notifyVideos(notifications: VideoNotification): Promise<undefined> {
    const client = new Client({ intents: [Intents.FLAGS.GUILDS] });
    await client.login(this.discordToken);
    const channel = (await client.channels.fetch(
      this.discordChannel
    )) as TextChannel;
    const promises = notifications.groups.map((group) => {
      group.content
        .map(convertVideo)
        .filter((_, index) => index < 3)
        .map((notification) => {
          return channel.send(notification);
        });
    });

    await Promise.all(promises);
    return Promise.resolve(undefined);
  }
}
