/**
 * Discord's channel permission resolution, computed from raw REST payloads.
 *
 * discord.js normally does this for you through `GuildMember#permissionsIn`,
 * but that reads the gateway cache: it needs the guild, its roles, the member,
 * and the channel to already be resident. Web requests must be answerable with
 * no gateway connection at all, so the same algorithm is reproduced here over
 * the REST shapes in `bot-rest-schemas.ts`.
 *
 * The order below is Discord's, and the order is the whole algorithm — applying
 * the member overwrite before the role overwrites, or skipping the @everyone
 * pass, silently produces a *different* channel list than Discord would.
 *
 * https://discord.com/developers/docs/topics/permissions#permission-overwrites
 */

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { DiscordOverwrite } from "#src/lib/discord/bot-rest-schemas.ts";

/** Overwrite `type` discriminants on the wire. */
const OVERWRITE_TYPE_ROLE = 0;
const OVERWRITE_TYPE_MEMBER = 1;

/**
 * The member's guild-wide permissions: the @everyone role (whose id is the
 * guild id) unioned with every role they hold.
 */
function basePermissions(input: {
  guildId: string;
  memberRoleIds: readonly string[];
  rolePermissions: ReadonlyMap<string, string>;
}): bigint {
  let base = BigInt(input.rolePermissions.get(input.guildId) ?? "0");
  for (const roleId of input.memberRoleIds) {
    const permissions = input.rolePermissions.get(roleId);
    if (permissions !== undefined) base |= BigInt(permissions);
  }
  return base;
}

function applyOverwrite(
  permissions: bigint,
  overwrite: { allow: string; deny: string },
): bigint {
  return (permissions & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow);
}

/**
 * The permissions `memberId` holds inside one channel.
 *
 * `rolePermissions` maps every role id in the guild (including @everyone, keyed
 * by the guild id) to its decimal bitfield string.
 */
export function computeChannelPermissions(input: {
  guildId: string;
  memberId: string;
  memberRoleIds: readonly string[];
  rolePermissions: ReadonlyMap<string, string>;
  overwrites: readonly DiscordOverwrite[];
}): bigint {
  const base = basePermissions(input);
  // Administrator short-circuits every overwrite, at the guild level only.
  if ((base & PermissionFlagsBits.Administrator) !== 0n) {
    return PermissionsBitField.All;
  }

  const everyone = input.overwrites.find(
    (overwrite) => overwrite.id === input.guildId,
  );
  let permissions =
    everyone === undefined ? base : applyOverwrite(base, everyone);

  // Every role overwrite is accumulated first and applied as one pass, so a
  // deny on one role cannot cancel an allow on another applied later.
  const memberRoles = new Set(input.memberRoleIds);
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of input.overwrites) {
    if (overwrite.type !== OVERWRITE_TYPE_ROLE) continue;
    if (overwrite.id === input.guildId) continue;
    if (!memberRoles.has(overwrite.id)) continue;
    roleAllow |= BigInt(overwrite.allow);
    roleDeny |= BigInt(overwrite.deny);
  }
  permissions = (permissions & ~roleDeny) | roleAllow;

  const member = input.overwrites.find(
    (overwrite) =>
      overwrite.type === OVERWRITE_TYPE_MEMBER &&
      overwrite.id === input.memberId,
  );
  return member === undefined
    ? permissions
    : applyOverwrite(permissions, member);
}

/** Whether every bit in `flag` is set in `permissions`. */
export function hasPermission(permissions: bigint, flag: bigint): boolean {
  return (permissions & flag) === flag;
}
