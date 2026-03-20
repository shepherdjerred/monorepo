import type { Client, Guild } from "discord.js";

type MemberResult = {
  success: boolean;
  message: string;
  data?:
    | {
        id: string;
        username: string;
        displayName: string;
        joinedAt: string | null;
        roles: string[];
        isOwner: boolean;
      }
    | {
        id: string;
        username: string;
        displayName: string;
        joinedAt?: string | null;
      }[];
};

export async function handleGetMember(
  guild: Guild,
  memberId: string | undefined,
): Promise<MemberResult> {
  if (memberId == null || memberId.length === 0) {
    return { success: false, message: "memberId is required for get" };
  }
  const member = await guild.members.fetch(memberId);
  return {
    success: true,
    message: `Found member ${member.user.username}`,
    data: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
      joinedAt: member.joinedAt?.toISOString() ?? null,
      roles: member.roles.cache.map((r) => r.name),
      isOwner: guild.ownerId === member.id,
    },
  };
}

export async function handleSearchMembers(
  guild: Guild,
  query: string | undefined,
  limit: number | undefined,
): Promise<MemberResult> {
  if (query == null || query.length === 0) {
    return { success: false, message: "query is required for search" };
  }
  const members = await guild.members.search({
    query,
    limit: limit ?? 10,
  });
  const list = members.map((m) => ({
    id: m.id,
    username: m.user.username,
    displayName: m.displayName,
  }));
  return {
    success: true,
    message: `Found ${String(list.length)} members`,
    data: list,
  };
}

export async function handleListMembers(
  guild: Guild,
  limit: number | undefined,
): Promise<MemberResult> {
  const members = await guild.members.fetch({ limit: limit ?? 100 });
  const list = members.map((m) => ({
    id: m.id,
    username: m.user.username,
    displayName: m.displayName,
    joinedAt: m.joinedAt?.toISOString() ?? null,
  }));
  return {
    success: true,
    message: `Retrieved ${String(list.length)} members`,
    data: list,
  };
}

export async function handleModifyMember(
  client: Client,
  guild: Guild,
  memberId: string | undefined,
  nickname: string | null | undefined,
): Promise<MemberResult> {
  if (memberId == null || memberId.length === 0) {
    return { success: false, message: "memberId is required for modify" };
  }
  if (nickname === undefined) {
    return { success: false, message: "nickname is required for modify" };
  }
  if (memberId === client.user?.id) {
    return {
      success: false,
      message:
        "Cannot modify bot's own nickname. Nickname changes happen via election only.",
    };
  }
  const member = await guild.members.fetch(memberId);
  await member.setNickname(nickname);
  return {
    success: true,
    message:
      nickname != null && nickname.length > 0
        ? `Set nickname to "${nickname}"`
        : "Reset nickname",
  };
}

export async function handleAddRole(
  guild: Guild,
  memberId: string | undefined,
  roleId: string | undefined,
  reason: string | undefined,
): Promise<MemberResult> {
  if (
    memberId == null ||
    memberId.length === 0 ||
    roleId == null ||
    roleId.length === 0
  ) {
    return {
      success: false,
      message: "memberId and roleId are required for add-role",
    };
  }
  const member = await guild.members.fetch(memberId);
  const role = await guild.roles.fetch(roleId);
  if (role == null) {
    return { success: false, message: "Role not found" };
  }
  await member.roles.add(role, reason);
  return {
    success: true,
    message: `Added role @${role.name} to ${member.user.username}`,
  };
}

export async function handleRemoveRole(
  guild: Guild,
  memberId: string | undefined,
  roleId: string | undefined,
  reason: string | undefined,
): Promise<MemberResult> {
  if (
    memberId == null ||
    memberId.length === 0 ||
    roleId == null ||
    roleId.length === 0
  ) {
    return {
      success: false,
      message: "memberId and roleId are required for remove-role",
    };
  }
  const member = await guild.members.fetch(memberId);
  const role = await guild.roles.fetch(roleId);
  if (role == null) {
    return { success: false, message: "Role not found" };
  }
  await member.roles.remove(role, reason);
  return {
    success: true,
    message: `Removed role @${role.name} from ${member.user.username}`,
  };
}
