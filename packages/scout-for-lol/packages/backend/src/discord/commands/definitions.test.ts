import { afterEach, describe, expect, test } from "vitest";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import {
  baseCommandDefinitions,
  globalCommandPayload,
  guildScopedCommandGroups,
} from "#src/discord/commands/definitions.ts";
import { listGuildsWithFlagEnabled } from "#src/configuration/flags.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { isPublicBbSubcommand } from "#src/discord/commands/bb.ts";
import { bbCommand } from "#src/discord/commands/bb-definition.ts";
import { lobbyCommand } from "#src/discord/commands/lobby-definition.ts";

const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];
const originalEnvironment = Bun.env["ENVIRONMENT"];

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
  resetConfigurationForTests();
});

describe("registered Discord commands", () => {
  test("keeps beta's global surface web-first", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    resetConfigurationForTests();
    expect(globalCommandPayload().map((command) => command.name)).toEqual([
      "help",
      "setup",
      "status",
      "invite",
      "docs",
      "track",
      "list",
    ]);
  });

  test("adds guild-only /scout to production's global surface", () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();
    const payload = globalCommandPayload();
    expect(payload.map((command) => command.name)).toEqual([
      "help",
      "setup",
      "status",
      "invite",
      "docs",
      "track",
      "list",
      "scout",
    ]);
    expect(payload.find((command) => command.name === "scout")).toEqual(
      expect.objectContaining({
        contexts: [InteractionContextType.Guild],
        integration_types: [ApplicationIntegrationType.GuildInstall],
      }),
    );
  });

  test("keeps beta-only commands out of the global surface", () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();
    // `bb` is registered per guild, so it must not leak into the global list —
    // that would put it in the picker of every guild Scout is in, where it
    // cannot do anything.
    const globalNames = globalCommandPayload().map((command) => command.name);
    expect(globalNames).not.toContain("bb");
    expect(globalNames).not.toContain("lobby");
  });

  test("resolves flag and Explore guild scopes independently", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "100000000000000001";
    resetConfigurationForTests();
    expect(listGuildsWithFlagEnabled("betting_enabled").length).toBeGreaterThan(
      0,
    );
    const byCommand = new Map(
      guildScopedCommandGroups.map((group) => [
        group.payload.map((command) => command.name).join(","),
        group.enabledGuildIds(),
      ]),
    );
    expect(byCommand.get("bb")?.length).toBeGreaterThan(0);
    expect(byCommand.get("scout")).toEqual(["100000000000000001"]);
  });

  test("defines /scout ask with the Explore question bounds", () => {
    const scout = guildScopedCommandGroups
      .flatMap((group) => group.payload)
      .find((command) => command.name === "scout");
    expect(scout).toEqual(
      expect.objectContaining({
        name: "scout",
        options: [
          expect.objectContaining({
            name: "ask",
            options: [
              expect.objectContaining({
                name: "question",
                required: true,
                min_length: 1,
                max_length: 2000,
              }),
            ],
          }),
        ],
      }),
    );
  });

  test("keeps global-only fields out of beta's guild /scout payload", () => {
    const scout = guildScopedCommandGroups
      .flatMap((group) => group.payload)
      .find((command) => command.name === "scout");
    const wirePayload = JSON.stringify(scout);
    expect(wirePayload).not.toContain('"contexts"');
    expect(wirePayload).not.toContain('"integration_types"');
  });

  test("registers no /bb ask subcommand — analysis lives in /scout ask", () => {
    // The Bryan Bucks analyst merged into the Explore agent; a second entry
    // point coming back is a product decision, not a refactor.
    const names =
      bbCommand.toJSON().options?.map((option) => option.name) ?? [];
    expect(names).not.toContain("ask");
    expect(isPublicBbSubcommand("rules")).toBe(true);
    expect(isPublicBbSubcommand("prizes")).toBe(true);
  });

  test("registers private /bb notifications toggles", () => {
    const notifications = bbCommand
      .toJSON()
      .options?.find((option) => option.name === "notifications");
    if (notifications === undefined || !("options" in notifications)) {
      throw new Error("/bb notifications should be a subcommand");
    }

    expect(notifications).toEqual(
      expect.objectContaining({
        name: "notifications",
        description: "Choose which Bryan Bucks DMs you receive",
      }),
    );
    expect(notifications.options).toEqual([
      expect.objectContaining({
        name: "your_bets",
        required: false,
        choices: [
          { name: "On", value: "on" },
          { name: "Off", value: "off" },
        ],
      }),
      expect.objectContaining({
        name: "bets_on_you",
        required: false,
        choices: [
          { name: "On", value: "on" },
          { name: "Off", value: "off" },
        ],
      }),
      expect.objectContaining({
        name: "dare_lifecycle",
        required: false,
        choices: [
          { name: "On", value: "on" },
          { name: "Off", value: "off" },
        ],
      }),
      expect.objectContaining({
        name: "dare_progress",
        required: false,
        choices: [
          { name: "On", value: "on" },
          { name: "Off", value: "off" },
        ],
      }),
    ]);
    expect(isPublicBbSubcommand("notifications")).toBe(false);
  });

  test("defines an open /lobby create without a player roster", () => {
    const create = lobbyCommand
      .toJSON()
      .options?.find((option) => option.name === "create");
    if (create === undefined || !("options" in create)) {
      throw new Error("/lobby create should be a subcommand");
    }

    expect(create.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "size",
          required: false,
          choices: expect.arrayContaining([{ name: "5v5", value: 5 }]),
        }),
        expect.objectContaining({
          name: "region",
          required: false,
          choices: expect.arrayContaining([
            { name: "North America", value: "AMERICA_NORTH" },
          ]),
        }),
      ]),
    );
    expect(create.options?.map((option) => option.name)).not.toContain("blue");
    expect(create.options?.map((option) => option.name)).not.toContain("red");
  });

  test("does not register autocomplete options", () => {
    expect(
      baseCommandDefinitions.flatMap((command) =>
        "options" in command ? command.options : [],
      ),
    ).not.toContainEqual(expect.objectContaining({ autocomplete: true }));
  });

  test("defines no redemption, donation, burn, or claim command", () => {
    const registered = [
      ...baseCommandDefinitions.map((command) => command.toJSON()),
      ...guildScopedCommandGroups.flatMap((group) => group.payload),
    ];
    const serialized = JSON.stringify(registered).toLowerCase();

    for (const absent of ["redeem", "redemption", "donate", "burn", "claim"]) {
      expect(serialized).not.toContain(`"name":"${absent}"`);
    }
  });
});
