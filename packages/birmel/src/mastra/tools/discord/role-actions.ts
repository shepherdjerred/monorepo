import type { Guild } from "discord.js";

type RoleResult = {
  success: boolean;
  message: string;
  data?:
    | {
        id: string;
        name: string;
        color: string;
        position: number;
        memberCount: number;
      }[]
    | {
        id: string;
        name: string;
        color: string;
        position: number;
        hoist: boolean;
        mentionable: boolean;
        memberCount: number;
        permissions: string[];
      }
    | { roleId: string };
};

export async function handleListRoles(guild: Guild): Promise<RoleResult> {
  const roles = await guild.roles.fetch();
  const roleList = roles
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      memberCount: role.members.size,
    }))
    .toSorted((a, b) => b.position - a.position);
  return {
    success: true,
    message: `Found ${String(roleList.length)} roles`,
    data: roleList,
  };
}

export async function handleGetRole(
  guild: Guild,
  roleId: string | undefined,
): Promise<RoleResult> {
  if (roleId == null || roleId.length === 0) {
    return {
      success: false,
      message: "roleId is required for getting role details",
    };
  }
  const role = await guild.roles.fetch(roleId);
  if (role == null) {
    return { success: false, message: "Role not found" };
  }
  return {
    success: true,
    message: `Found role @${role.name}`,
    data: {
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      hoist: role.hoist,
      mentionable: role.mentionable,
      memberCount: role.members.size,
      permissions: role.permissions.toArray(),
    },
  };
}

type CreateRoleOptions = {
  guild: Guild;
  name: string | undefined;
  color: string | undefined;
  hoist: boolean | undefined;
  mentionable: boolean | undefined;
};

export async function handleCreateRole(
  options: CreateRoleOptions,
): Promise<RoleResult> {
  const { guild, name, color, hoist, mentionable } = options;
  if (name == null || name.length === 0) {
    return {
      success: false,
      message: "name is required for creating a role",
    };
  }
  const existingRoles = await guild.roles.fetch();
  if (existingRoles.size >= 240) {
    return {
      success: false,
      message: `Server has too many roles (${String(existingRoles.size)}/250). Delete some roles before creating new ones.`,
    };
  }
  const colorNum =
    color === undefined
      ? undefined
      : Number.parseInt(color.replace("#", ""), 16);
  const role = await guild.roles.create({
    name,
    ...(colorNum !== undefined && { color: colorNum }),
    ...(hoist !== undefined && { hoist }),
    ...(mentionable !== undefined && { mentionable }),
  });
  return {
    success: true,
    message: `Created role @${role.name}`,
    data: { roleId: role.id },
  };
}

type ModifyRoleOptions = {
  guild: Guild;
  roleId: string | undefined;
  name: string | undefined;
  color: string | undefined;
  hoist: boolean | undefined;
  mentionable: boolean | undefined;
};

export async function handleModifyRole(
  options: ModifyRoleOptions,
): Promise<RoleResult> {
  const { guild, roleId, name, color, hoist, mentionable } = options;
  if (roleId == null || roleId.length === 0) {
    return {
      success: false,
      message: "roleId is required for modifying a role",
    };
  }
  const role = await guild.roles.fetch(roleId);
  if (role == null) {
    return { success: false, message: "Role not found" };
  }
  const hasChanges =
    name !== undefined ||
    color !== undefined ||
    hoist !== undefined ||
    mentionable !== undefined;
  if (!hasChanges) {
    return { success: false, message: "No changes specified" };
  }
  const editColorNum =
    color === undefined
      ? undefined
      : Number.parseInt(color.replace("#", ""), 16);
  await role.edit({
    ...(name !== undefined && { name }),
    ...(editColorNum !== undefined && { color: editColorNum }),
    ...(hoist !== undefined && { hoist }),
    ...(mentionable !== undefined && { mentionable }),
  });
  return { success: true, message: `Updated role @${role.name}` };
}

export async function handleDeleteRole(
  guild: Guild,
  roleId: string | undefined,
  reason: string | undefined,
): Promise<RoleResult> {
  if (roleId == null || roleId.length === 0) {
    return {
      success: false,
      message: "roleId is required for deleting a role",
    };
  }
  const role = await guild.roles.fetch(roleId);
  if (role == null) {
    return { success: false, message: "Role not found" };
  }
  const roleName = role.name;
  await role.delete(reason);
  return { success: true, message: `Deleted role @${roleName}` };
}

export async function handleReorderRoles(
  guild: Guild,
  positions: { roleId: string; position: number }[] | undefined,
): Promise<RoleResult> {
  if (!positions || positions.length === 0) {
    return {
      success: false,
      message: "positions array is required for reordering roles",
    };
  }
  await guild.roles.setPositions(
    positions.map((p: { roleId: string; position: number }) => ({
      role: p.roleId,
      position: p.position,
    })),
  );
  return {
    success: true,
    message: `Reordered ${String(positions.length)} roles`,
  };
}
