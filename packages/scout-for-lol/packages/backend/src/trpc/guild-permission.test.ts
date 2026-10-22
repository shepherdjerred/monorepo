import { afterEach, describe, expect, test } from "vitest";
import { Routes } from "discord.js";
import { TRPCError } from "@trpc/server";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  createBotRestReader,
  installBotRestReader,
  type BotRestGet,
} from "#src/lib/discord/bot-rest.ts";
import { resolveGuildPermissionsForMember } from "#src/trpc/guild-permission.ts";

const GUILD = DiscordGuildIdSchema.parse("111111111111111111");
const OWNER = DiscordAccountIdSchema.parse("222222222222222222");
const ADMIN = DiscordAccountIdSchema.parse("333333333333333333");
const STRANGER = DiscordAccountIdSchema.parse("444444444444444444");
const ADMIN_ROLE = "555555555555555555";

function member(id: string, roles: string[]) {
  return {
    user: { id, username: `user-${id}` },
    roles,
  };
}

function absent(code: number): never {
  throw Object.assign(new Error("Unknown"), { code, status: 404 });
}

/** A guild with an owner and one member whose role carries Administrator. */
const transport: BotRestGet = (route) => {
  const answers = new Map<string, unknown>([
    [Routes.guild(GUILD), { id: GUILD, name: "Guild", owner_id: OWNER }],
    [Routes.guildMember(GUILD, OWNER), member(OWNER, [])],
    [Routes.guildMember(GUILD, ADMIN), member(ADMIN, [ADMIN_ROLE])],
    [
      Routes.guildRoles(GUILD),
      [
        { id: GUILD, name: "@everyone", permissions: "0" },
        { id: ADMIN_ROLE, name: "Admin", permissions: "8" },
      ],
    ],
  ]);
  if (answers.has(route)) return Promise.resolve(answers.get(route));
  return route.startsWith(`/guilds/${GUILD}/`)
    ? absent(10_007)
    : absent(10_004);
};

let restore: (() => void) | undefined;

function useTransport(): void {
  restore = installBotRestReader(
    createBotRestReader({ get: transport, botUserId: "999999999999999999" }),
  );
}

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("resolveGuildPermissionsForMember", () => {
  test("the guild owner holds every permission", async () => {
    useTransport();
    const permissions = await resolveGuildPermissionsForMember(OWNER, GUILD);
    expect(permissions.can("reports", "create")).toBe(true);
    expect(permissions.can("subscriptions", "create")).toBe(true);
  });

  test("a role carrying Administrator is root, like the web path", async () => {
    useTransport();
    const permissions = await resolveGuildPermissionsForMember(ADMIN, GUILD);
    expect(permissions.can("competitions", "create")).toBe(true);
  });

  test("someone who is not a member is FORBIDDEN", async () => {
    useTransport();
    const outcome = resolveGuildPermissionsForMember(STRANGER, GUILD);
    await expect(outcome).rejects.toBeInstanceOf(TRPCError);
    await expect(outcome).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a guild Scout is not in is NOT_FOUND", async () => {
    useTransport();
    const outcome = resolveGuildPermissionsForMember(
      OWNER,
      DiscordGuildIdSchema.parse("666666666666666666"),
    );
    await expect(outcome).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
