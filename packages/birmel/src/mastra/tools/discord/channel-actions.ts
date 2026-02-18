import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type GuildChannelEditOptions,
} from "discord.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";

const logger = loggers.tools.child("discord.channels");

type ChannelResult = {
  success: boolean;
  message: string;
  data?:
    | { id: string; name: string; type: string; parentId: string | null }[]
    | {
        id: string;
        name: string;
        type: string;
        topic: string | null;
        parentId: string | null;
        position: number;
      }
    | { channelId: string };
};

export async function handleList(
  client: Client,
  guildId: string | undefined,
): Promise<ChannelResult> {
  if (guildId == null || guildId.length === 0) {
    return { success: false, message: "guildId is required for list" };
  }
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const list = channels.map((ch) => ({
    id: ch?.id ?? "",
    name: ch?.name ?? "",
    type: ch?.type === undefined ? "Unknown" : ChannelType[ch.type],
    parentId: ch?.parentId ?? null,
  }));
  return {
    success: true,
    message: `Found ${String(list.length)} channels`,
    data: list,
  };
}

export async function handleGet(
  client: Client,
  channelId: string | undefined,
): Promise<ChannelResult> {
  if (channelId == null || channelId.length === 0) {
    return { success: false, message: "channelId is required for get" };
  }
  const channel = await client.channels.fetch(channelId);
  if (channel == null) {
    return { success: false, message: "Channel not found" };
  }
  return {
    success: true,
    message: "Retrieved channel information",
    data: {
      id: channel.id,
      name: "name" in channel ? (channel.name ?? "Unknown") : "Unknown",
      type: ChannelType[channel.type],
      topic: "topic" in channel ? channel.topic : null,
      parentId: "parentId" in channel ? channel.parentId : null,
      position: "position" in channel ? channel.position : 0,
    },
  };
}

export async function handleCreate(
  client: Client,
  guildId: string | undefined,
  name: string | undefined,
  type: "text" | "voice" | "category" | undefined,
  parentId: string | null | undefined,
  topic: string | undefined,
): Promise<ChannelResult> {
  if (
    guildId == null ||
    guildId.length === 0 ||
    name == null ||
    name.length === 0 ||
    !type
  ) {
    return {
      success: false,
      message: "guildId, name, and type are required for create",
    };
  }
  const guild = await client.guilds.fetch(guildId);
  const existingChannels = await guild.channels.fetch();
  if (existingChannels.size >= 450) {
    return {
      success: false,
      message: `Server has too many channels (${String(existingChannels.size)}/500). Delete some channels before creating new ones.`,
    };
  }
  const typeMap = {
    text: ChannelType.GuildText,
    voice: ChannelType.GuildVoice,
    category: ChannelType.GuildCategory,
  } as const;
  const channel = await guild.channels.create({
    name,
    type: typeMap[type],
    ...(parentId !== undefined && { parent: parentId }),
    ...(topic !== undefined && { topic }),
  });
  return {
    success: true,
    message: `Created channel #${channel.name}`,
    data: { channelId: channel.id },
  };
}

export async function handleModify(
  client: Client,
  channelId: string | undefined,
  name: string | undefined,
  topic: string | undefined,
  position: number | undefined,
  parentId: string | null | undefined,
): Promise<ChannelResult> {
  if (channelId == null || channelId.length === 0) {
    return { success: false, message: "channelId is required for modify" };
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("edit" in channel)) {
    return {
      success: false,
      message: "Channel not found or cannot be edited",
    };
  }
  const opts: GuildChannelEditOptions = {};
  if (name !== undefined) {
    opts.name = name;
  }
  if (topic !== undefined) {
    opts.topic = topic;
  }
  if (position !== undefined) {
    opts.position = position;
  }
  if (parentId !== undefined) {
    opts.parent = parentId;
  }
  await channel.edit(opts as Parameters<typeof channel.edit>[0]);
  return { success: true, message: "Channel updated successfully" };
}

export async function handleDelete(
  client: Client,
  channelId: string | undefined,
  reason: string | undefined,
): Promise<ChannelResult> {
  if (channelId == null || channelId.length === 0) {
    return { success: false, message: "channelId is required for delete" };
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("delete" in channel)) {
    return {
      success: false,
      message: "Channel not found or cannot be deleted",
    };
  }
  await channel.delete(reason);
  return { success: true, message: "Channel deleted successfully" };
}

export async function handleReorder(
  client: Client,
  guildId: string | undefined,
  positions: { channelId: string; position: number }[] | undefined,
): Promise<ChannelResult> {
  if (guildId == null || guildId.length === 0 || positions?.length == null) {
    return {
      success: false,
      message: "guildId and positions are required for reorder",
    };
  }
  const guild = await client.guilds.fetch(guildId);
  await guild.channels.setPositions(
    positions.map((p) => ({
      channel: p.channelId,
      position: p.position,
    })),
  );
  return {
    success: true,
    message: `Reordered ${String(positions.length)} channels`,
  };
}

export const normalizePermissionName = (perm: string): string => {
  if (perm in PermissionFlagsBits) {
    return perm;
  }
  const pascalCase = perm
    .toLowerCase()
    .split("_")
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (pascalCase in PermissionFlagsBits) {
    return pascalCase;
  }
  logger.warn(`Unknown permission name: ${perm}`);
  return perm;
};

export async function handleSetPermissions(
  client: Client,
  channelId: string | undefined,
  targetId: string | undefined,
  allow: string[] | undefined,
  deny: string[] | undefined,
): Promise<ChannelResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    targetId == null ||
    targetId.length === 0
  ) {
    return {
      success: false,
      message: "channelId and targetId are required for set-permissions",
    };
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("permissionOverwrites" in channel)) {
    return {
      success: false,
      message: "Channel not found or does not support permissions",
    };
  }
  await channel.permissionOverwrites.edit(targetId, {
    ...allow?.reduce(
      (acc: Record<string, boolean>, perm: string) => ({
        ...acc,
        [normalizePermissionName(perm)]: true,
      }),
      {},
    ),
    ...deny?.reduce(
      (acc: Record<string, boolean>, perm: string) => ({
        ...acc,
        [normalizePermissionName(perm)]: false,
      }),
      {},
    ),
  });
  return {
    success: true,
    message: "Channel permissions updated successfully",
  };
}
