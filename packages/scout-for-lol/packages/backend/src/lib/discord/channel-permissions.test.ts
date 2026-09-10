import { describe, expect, test } from "vitest";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import {
  computeChannelPermissions,
  hasPermission,
} from "#src/lib/discord/channel-permissions.ts";

const GUILD = "100";
const MEMBER = "200";
const ROLE = "300";
const OTHER_ROLE = "400";

const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;

function permissions(input: {
  rolePermissions: Record<string, string>;
  memberRoleIds?: string[];
  guildOwnerId?: string | null;
  overwrites?: {
    id: string;
    type: number;
    allow: string;
    deny: string;
  }[];
}): bigint {
  return computeChannelPermissions({
    guildId: GUILD,
    guildOwnerId: input.guildOwnerId ?? null,
    memberId: MEMBER,
    memberRoleIds: input.memberRoleIds ?? [],
    rolePermissions: new Map(Object.entries(input.rolePermissions)),
    overwrites: input.overwrites ?? [],
  });
}

describe("computeChannelPermissions", () => {
  test("unions @everyone with the member's roles", () => {
    const result = permissions({
      rolePermissions: {
        [GUILD]: VIEW.toString(),
        [ROLE]: SEND.toString(),
      },
      memberRoleIds: [ROLE],
    });
    expect(hasPermission(result, VIEW)).toBe(true);
    expect(hasPermission(result, SEND)).toBe(true);
  });

  test("ignores roles the member does not hold", () => {
    const result = permissions({
      rolePermissions: {
        [GUILD]: VIEW.toString(),
        [ROLE]: SEND.toString(),
      },
    });
    expect(hasPermission(result, SEND)).toBe(false);
  });

  test("the guild owner holds everything with no role saying so", () => {
    // The common real setup: whoever made the server never gave themselves an
    // Administrator role, because they never needed one.
    const result = permissions({
      guildOwnerId: MEMBER,
      rolePermissions: { [GUILD]: "0" },
    });
    expect(result).toBe(PermissionsBitField.All);
    expect(hasPermission(result, PermissionFlagsBits.Administrator)).toBe(true);
  });

  test("the owner grant survives an explicit channel denial", () => {
    // Same gate `listPostableChannels` applies, against a channel that denies
    // @everyone outright.
    const result = permissions({
      guildOwnerId: MEMBER,
      rolePermissions: { [GUILD]: "0" },
      overwrites: [
        { id: GUILD, type: 0, allow: "0", deny: (VIEW | SEND).toString() },
        { id: MEMBER, type: 1, allow: "0", deny: (VIEW | SEND).toString() },
      ],
    });
    expect(hasPermission(result, VIEW)).toBe(true);
    expect(hasPermission(result, SEND)).toBe(true);
  });

  test("a different member is not granted the owner's permissions", () => {
    const result = permissions({
      guildOwnerId: "999",
      rolePermissions: { [GUILD]: VIEW.toString() },
    });
    expect(hasPermission(result, PermissionFlagsBits.Administrator)).toBe(
      false,
    );
    expect(hasPermission(result, SEND)).toBe(false);
  });

  test("guild Administrator wins over every channel denial", () => {
    const result = permissions({
      rolePermissions: {
        [GUILD]: PermissionFlagsBits.Administrator.toString(),
      },
      overwrites: [
        { id: GUILD, type: 0, allow: "0", deny: (VIEW | SEND).toString() },
      ],
    });
    expect(result).toBe(PermissionsBitField.All);
  });

  test("an @everyone overwrite denies, a role overwrite restores", () => {
    const denied = permissions({
      rolePermissions: { [GUILD]: (VIEW | SEND).toString() },
      overwrites: [{ id: GUILD, type: 0, allow: "0", deny: SEND.toString() }],
    });
    expect(hasPermission(denied, SEND)).toBe(false);

    const restored = permissions({
      rolePermissions: { [GUILD]: (VIEW | SEND).toString(), [ROLE]: "0" },
      memberRoleIds: [ROLE],
      overwrites: [
        { id: GUILD, type: 0, allow: "0", deny: SEND.toString() },
        { id: ROLE, type: 0, allow: SEND.toString(), deny: "0" },
      ],
    });
    expect(hasPermission(restored, SEND)).toBe(true);
  });

  test("role overwrites are one pass: an allow on any held role wins", () => {
    // Applied one at a time in list order, the trailing deny would win and the
    // member would lose SendMessages — Discord's answer is that it does not.
    const result = permissions({
      rolePermissions: {
        [GUILD]: VIEW.toString(),
        [ROLE]: "0",
        [OTHER_ROLE]: "0",
      },
      memberRoleIds: [ROLE, OTHER_ROLE],
      overwrites: [
        { id: ROLE, type: 0, allow: SEND.toString(), deny: "0" },
        { id: OTHER_ROLE, type: 0, allow: "0", deny: SEND.toString() },
      ],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });

  test("a member overwrite beats every role overwrite", () => {
    const result = permissions({
      rolePermissions: { [GUILD]: (VIEW | SEND).toString(), [ROLE]: "0" },
      memberRoleIds: [ROLE],
      overwrites: [
        { id: ROLE, type: 0, allow: SEND.toString(), deny: "0" },
        { id: MEMBER, type: 1, allow: "0", deny: SEND.toString() },
      ],
    });
    expect(hasPermission(result, SEND)).toBe(false);
  });

  test("a member overwrite for someone else is not applied", () => {
    const result = permissions({
      rolePermissions: { [GUILD]: (VIEW | SEND).toString() },
      overwrites: [{ id: "999", type: 1, allow: "0", deny: SEND.toString() }],
    });
    expect(hasPermission(result, SEND)).toBe(true);
  });
});
