import {
  ChannelInventoryEntrySchema,
  type ChannelInventoryEntry,
  type DiscordApiChannel,
} from "#shared/glitter-corpus.ts";

const VIEW_CHANNEL = 1n << 10n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const ADMINISTRATOR = 1n << 3n;
const ALL_PERMISSIONS = (1n << 53n) - 1n;

function applyOverwrite(
  permissions: bigint,
  overwrite: { allow: string; deny: string } | undefined,
): bigint {
  if (overwrite === undefined) {
    return permissions;
  }
  return (permissions & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow);
}

export function effectiveChannelPermissions(input: {
  guildId: string;
  botUserId: string;
  roleIds: readonly string[];
  guildRoles: readonly { id: string; permissions: string }[];
  channel: DiscordApiChannel;
}): bigint {
  const everyone = input.guildRoles.find((role) => role.id === input.guildId);
  if (everyone === undefined) {
    throw new Error(`Discord guild ${input.guildId} has no @everyone role`);
  }
  let permissions = BigInt(everyone.permissions);
  for (const roleId of input.roleIds) {
    const role = input.guildRoles.find((candidate) => candidate.id === roleId);
    if (role === undefined) {
      throw new Error(
        `Discord member references missing role ${roleId} in guild ${input.guildId}`,
      );
    }
    permissions |= BigInt(role.permissions);
  }
  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }

  const overwrites = input.channel.permission_overwrites ?? [];
  permissions = applyOverwrite(
    permissions,
    overwrites.find(
      (overwrite) => overwrite.type === 0 && overwrite.id === input.guildId,
    ),
  );

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === 0 && input.roleIds.includes(overwrite.id)) {
      roleAllow |= BigInt(overwrite.allow);
      roleDeny |= BigInt(overwrite.deny);
    }
  }
  permissions = (permissions & ~roleDeny) | roleAllow;
  permissions = applyOverwrite(
    permissions,
    overwrites.find(
      (overwrite) => overwrite.type === 1 && overwrite.id === input.botUserId,
    ),
  );
  return permissions;
}

function isMessageBearingPublicChannel(type: number): boolean {
  return type === 0 || type === 5 || type === 10 || type === 11;
}

export function canReadChannelHistory(input: {
  guildId: string;
  botUserId: string;
  roleIds: readonly string[];
  guildRoles: readonly { id: string; permissions: string }[];
  channel: DiscordApiChannel;
}): boolean {
  const permissions = effectiveChannelPermissions(input);
  const required = VIEW_CHANNEL | READ_MESSAGE_HISTORY;
  return (permissions & required) === required;
}

export function scopeEntry(input: {
  guildId: string;
  botUserId: string;
  memberRoleIds: readonly string[];
  guildRoles: readonly { id: string; permissions: string }[];
  denylist: ReadonlySet<string>;
  discoveredAt: string;
  channel: DiscordApiChannel;
  permissionChannel: DiscordApiChannel;
}): ChannelInventoryEntry {
  const channel = input.channel;
  let scopeDecision:
    | "include"
    | "exclude-denylist"
    | "exclude-private-thread"
    | "exclude-non-message-channel"
    | "exclude-no-history-permission";
  if (
    input.denylist.has(channel.id) ||
    (channel.parent_id !== undefined &&
      channel.parent_id !== null &&
      input.denylist.has(channel.parent_id))
  ) {
    scopeDecision = "exclude-denylist";
  } else if (channel.type === 12) {
    scopeDecision = "exclude-private-thread";
  } else if (isMessageBearingPublicChannel(channel.type)) {
    scopeDecision = canReadChannelHistory({
      guildId: input.guildId,
      botUserId: input.botUserId,
      roleIds: input.memberRoleIds,
      guildRoles: input.guildRoles,
      channel: input.permissionChannel,
    })
      ? "include"
      : "exclude-no-history-permission";
  } else {
    scopeDecision = "exclude-non-message-channel";
  }

  return ChannelInventoryEntrySchema.parse({
    guildId: input.guildId,
    channelId: channel.id,
    parentId: channel.parent_id ?? null,
    name: channel.name ?? channel.id,
    type: channel.type,
    archived: channel.thread_metadata?.archived ?? false,
    locked: channel.thread_metadata?.locked ?? false,
    scopeDecision,
    discoveredAt: input.discoveredAt,
  });
}
