import type { z } from "zod";
import type {
  ChannelsResponseSchema,
  GuildsResponseSchema,
  IpcMessage,
  StatusResponse,
  VoiceStatesResponseSchema,
} from "#lib/discord/ipc.ts";

export function renderMessage(message: IpcMessage): string {
  const lines: string[] = [];
  const bot = message.authorIsBot ? " [bot]" : "";
  lines.push(
    `- **${message.authorTag}**${bot} (${message.createdAt}, id ${message.id})`,
  );
  if (message.content.length > 0) {
    for (const contentLine of message.content.split("\n")) {
      lines.push(`  ${contentLine}`);
    }
  }
  for (const embed of message.embeds) {
    const title = embed.title ?? "(no title)";
    lines.push(`  - embed: **${title}**`);
    if (embed.description !== null && embed.description.length > 0) {
      lines.push(`    ${embed.description.split("\n").join(" / ")}`);
    }
    for (const field of embed.fields) {
      lines.push(`    - ${field.name}: ${field.value}`);
    }
  }
  for (const attachment of message.attachments) {
    lines.push(`  - attachment: [${attachment.name}](${attachment.url})`);
  }
  return lines.join("\n");
}

export function renderMessages(messages: IpcMessage[]): string {
  if (messages.length === 0) {
    return "No messages.";
  }
  return messages.map((message) => renderMessage(message)).join("\n");
}

export function renderStatus(status: StatusResponse): string {
  const lines: string[] = ["## Discord daemon", ""];
  lines.push(`- pid: ${String(status.pid)}`);
  lines.push(`- started: ${status.startedAt}`);
  lines.push(
    `- idle: ${String(status.idleSeconds)}s (auto-stops after ${String(status.ttlSeconds)}s idle)`,
  );
  if (status.identities.bot !== undefined) {
    lines.push(
      `- bot: ${status.identities.bot.tag} (${status.identities.bot.id})`,
    );
  }
  if (status.identities.user !== undefined) {
    lines.push(
      `- userbot: ${status.identities.user.tag} (${status.identities.user.id})`,
    );
  }
  lines.push(
    status.voice === null
      ? "- voice: not connected"
      : `- voice: in channel ${status.voice.channelId} (guild ${status.voice.guildId})`,
  );
  return lines.join("\n");
}

export function renderGuilds(
  guilds: z.infer<typeof GuildsResponseSchema>,
): string {
  const lines: string[] = [];
  for (const [identity, list] of [
    ["bot", guilds.bot],
    ["userbot", guilds.user],
  ] as const) {
    if (list.length === 0) {
      continue;
    }
    lines.push(`## ${identity} guilds`);
    for (const guild of list) {
      lines.push(`- ${guild.name} (${guild.id})`);
    }
    lines.push("");
  }
  return lines.length === 0 ? "No guilds." : lines.join("\n").trimEnd();
}

export function renderChannels(
  channels: z.infer<typeof ChannelsResponseSchema>,
): string {
  if (channels.channels.length === 0) {
    return "No channels.";
  }
  return channels.channels
    .map((channel) => {
      const parent =
        channel.parentName === null ? "" : ` — ${channel.parentName}`;
      return `- #${channel.name} (${channel.id}, ${channel.type}${parent})`;
    })
    .join("\n");
}

export function renderVoiceStates(
  response: z.infer<typeof VoiceStatesResponseSchema>,
): string {
  const active = response.states.filter((state) => state.channelId !== null);
  if (active.length === 0) {
    return "Nobody is in voice.";
  }
  return active
    .map((state) => {
      const flags = [
        state.streaming ? "STREAMING" : null,
        state.selfVideo ? "video" : null,
        state.selfMute ? "muted" : null,
        state.selfDeaf ? "deafened" : null,
      ]
        .filter((flag) => flag !== null)
        .join(", ");
      const tag = state.userTag ?? state.userId;
      return `- ${tag} in ${String(state.channelId)}${flags.length > 0 ? ` [${flags}]` : ""}`;
    })
    .join("\n");
}
