import type { GuildMember, PermissionResolvable } from "discord.js";

export function hasPermission(
  member: GuildMember,
  permission: PermissionResolvable,
): boolean {
  return member.permissions.has(permission);
}

export type PermissionCheckResult = {
  allowed: boolean;
  message?: string;
};

export function validateToolPermission(
  member: GuildMember,
  requiredPermission: PermissionResolvable,
  toolName: string,
): PermissionCheckResult {
  if (!hasPermission(member, requiredPermission)) {
    const permissionName =
      typeof requiredPermission === "string"
        ? requiredPermission
        : JSON.stringify(requiredPermission);
    return {
      allowed: false,
      message: `You don't have permission to use ${toolName}. Required: ${permissionName}`,
    };
  }
  return { allowed: true };
}

export function isAdmin(member: GuildMember): boolean {
  return member.permissions.has("Administrator");
}

export function canManageGuild(member: GuildMember): boolean {
  return member.permissions.has("ManageGuild");
}

export function canManageChannels(member: GuildMember): boolean {
  return member.permissions.has("ManageChannels");
}

export function canManageRoles(member: GuildMember): boolean {
  return member.permissions.has("ManageRoles");
}

export function canManageMessages(member: GuildMember): boolean {
  return member.permissions.has("ManageMessages");
}

export function canKickMembers(member: GuildMember): boolean {
  return member.permissions.has("KickMembers");
}

export function canBanMembers(member: GuildMember): boolean {
  return member.permissions.has("BanMembers");
}

export function canModerateMembers(member: GuildMember): boolean {
  return member.permissions.has("ModerateMembers");
}
