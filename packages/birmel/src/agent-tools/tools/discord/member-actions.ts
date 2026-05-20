import type { Client, Guild, GuildMember } from "discord.js";

type MemberResult = {
  success: boolean;
  message: string;
  /**
   * Set on destructive writes (add-role, remove-role, modify-nickname) to
   * indicate that the handler re-fetched member state after the write and
   * confirmed the intended change. False = the API call returned 2xx but the
   * post-write state does not match what was requested.
   */
  verified?: boolean;
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

function memberInfo(member: GuildMember, guild: Guild) {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    roles: member.roles.cache.map((r) => r.name),
    isOwner: guild.ownerId === member.id,
  };
}

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
    data: memberInfo(member, guild),
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
  // Read-back: re-fetch from API to confirm Discord actually applied the change.
  const fresh = await guild.members.fetch({ user: memberId, force: true });
  const expected =
    nickname != null && nickname.length > 0 ? nickname : fresh.user.username;
  const verified = fresh.displayName === expected;
  return {
    success: true,
    verified,
    message: verified
      ? nickname != null && nickname.length > 0
        ? `Set nickname to "${nickname}"`
        : "Reset nickname"
      : `Discord accepted the write but the displayName is still "${fresh.displayName}" instead of "${expected}"`,
    data: memberInfo(fresh, guild),
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
  // Read-back: re-fetch from API and confirm the role id is now on the member.
  const fresh = await guild.members.fetch({ user: memberId, force: true });
  const verified = fresh.roles.cache.has(role.id);
  return {
    success: true,
    verified,
    message: verified
      ? `Added role @${role.name} to ${member.user.username}`
      : `Discord accepted the add-role call but @${role.name} is not on ${member.user.username} after re-fetch (likely a role-hierarchy / permissions issue)`,
    data: memberInfo(fresh, guild),
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
  // Read-back: re-fetch from API and confirm the role id is gone.
  const fresh = await guild.members.fetch({ user: memberId, force: true });
  const verified = !fresh.roles.cache.has(role.id);
  return {
    success: true,
    verified,
    message: verified
      ? `Removed role @${role.name} from ${member.user.username}`
      : `Discord accepted the remove-role call but @${role.name} is still on ${member.user.username} after re-fetch (likely a role-hierarchy / permissions issue)`,
    data: memberInfo(fresh, guild),
  };
}
