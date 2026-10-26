import { type ChatInputCommandInteraction, type Message } from "discord.js";
import type { CommandBotDeps } from "./commands/command-bot-deps.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { musicCommandContext, type MusicInteraction } from "./music-context.ts";
import { musicErrorMessage } from "./music-access.ts";
import { loadMusicLink } from "./music-links.ts";
import {
  collectMusicCancellation,
  interactionMusicLinkReply,
  type MusicLinkReply,
} from "./music-link-reply.ts";
import { webPageUrl } from "./web-link.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/** Only a leading, complete command matches; ordinary chat is never submitted as a query. */
export function prefixPlayQuery(content: string): string | null {
  const match = /^!play(?:\s([\s\S]*))?$/iu.exec(content);
  return match === null ? null : (match[1] ?? "").trim();
}

export async function quickPlay(
  issuer: MusicInteraction,
  deps: CommandBotDeps,
  rawQuery: string,
  reply: MusicLinkReply,
): Promise<void> {
  if (issuer.guildId === null) {
    await reply.start({ content: "Use this command in a server." });
    return;
  }
  const query = rawQuery.trim().replace(/^<(https?:\/\/[^<>]+)>$/u, "$1");
  if (query === "") {
    await reply.start({
      content:
        "Try `/play query:artist or song` or `!play artist or song`. You can also paste a YouTube or Spotify link.",
    });
    return;
  }
  if (
    await loadMusicLink(
      issuer,
      deps,
      { query, placement: "queue", mode: null },
      reply,
    )
  )
    return;
  const context = await musicCommandContext(issuer, deps);
  await reply.start({ content: "Finding something to play…" });
  const result = await new PlaybackCommandService(context).play({
    query,
    source: "auto",
    placement: "queue",
    spoken: false,
    userId: UserIdSchema.parse(issuer.user.id),
  });
  const url = await webPageUrl(
    deps.config,
    { guildId: issuer.guildId, userId: issuer.user.id },
    "/music",
  );
  await reply.edit({
    content:
      result.message +
      (url === undefined ? "" : "\n[Open Streambot](" + url + ")"),
    allowedMentions: { parse: [] },
  });
}

export async function slashPlay(
  interaction: ChatInputCommandInteraction,
  deps: CommandBotDeps,
): Promise<void> {
  await quickPlay(
    interaction,
    deps,
    interaction.options.getString("query", true),
    interactionMusicLinkReply(interaction),
  );
}

export async function prefixPlay(
  message: Message,
  deps: CommandBotDeps,
): Promise<void> {
  if (
    message.author.bot ||
    message.webhookId !== null ||
    message.guildId === null
  )
    return;
  const query = prefixPlayQuery(message.content);
  if (query === null) return;
  let response: Message | undefined;
  const reply: MusicLinkReply = {
    start: async (payload) => {
      response = await message.reply({
        content: payload.content ?? "",
        ...(payload.components === undefined
          ? {}
          : { components: payload.components }),
        allowedMentions: { parse: [], repliedUser: false },
      });
    },
    edit: async (payload) => {
      if (response === undefined)
        throw new Error("Prefix reply has not started");
      return await response.edit(payload);
    },
    onCancel: (listener) => {
      if (response === undefined)
        throw new Error("Prefix reply has not started");
      collectMusicCancellation(response, listener);
      return Promise.resolve();
    },
  };
  try {
    await quickPlay(
      {
        guildId: message.guildId,
        guild: message.guild,
        user: message.author,
        channelId: message.channelId,
      },
      deps,
      query,
      reply,
    );
  } catch (error) {
    try {
      const payload = {
        content: musicErrorMessage(error),
        components: [],
        allowedMentions: { parse: [] },
      };
      if (response === undefined) await reply.start(payload);
      else await reply.edit(payload);
    } catch {
      logger.warn("prefix play reply could not be delivered");
    }
  }
}
