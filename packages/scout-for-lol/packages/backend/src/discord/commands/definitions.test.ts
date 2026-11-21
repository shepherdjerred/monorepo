import { resetConfigurationForTests } from "#src/configuration.ts";
import { listGuildsWithFlagEnabled } from "#src/configuration/flags.ts";
import {
  baseCommandDefinitions,
  globalCommandPayload,
  guildCommandPayload,
  guildScopedCommandGroups,
} from "#src/discord/commands/definitions.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { afterEach, describe, expect, test, vi } from "vitest";

// Context-menu command bodies carry no `options`; only chat-input commands
// such as /scout do, so narrow before reading the subcommand names.
function optionNames(
  command: RESTPostAPIApplicationCommandsJSONBody | undefined,
): string[] | undefined {
  return command !== undefined && "options" in command
    ? command.options?.map((option) => option.name)
    : undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigurationForTests();
});

describe("registered Discord commands", () => {
  test("keeps beta's global surface web-first", () => {
    vi.stubEnv("ENVIRONMENT", "beta");
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
    vi.stubEnv("ENVIRONMENT", "prod");
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
    const scout = payload.find((command) => command.name === "scout");
    expect(scout).toEqual(
      expect.objectContaining({
        contexts: [InteractionContextType.Guild],
        integration_types: [ApplicationIntegrationType.GuildInstall],
      }),
    );
    // Voice is beta-only: the production global /scout never carries it.
    expect(optionNames(scout)).toEqual(["ask"]);
  });

  test("keeps beta-only commands out of the global surface", () => {
    vi.stubEnv("ENVIRONMENT", "prod");
    resetConfigurationForTests();
    // Dares retain their beta guild scope; the retired economy has no command.
    const globalNames = globalCommandPayload().map((command) => command.name);
    expect(globalNames).not.toContain("dare");
    expect(globalNames).not.toContain("bb");
    expect(globalNames).not.toContain("lobby");
  });

  test("resolves flag and Explore guild scopes independently", () => {
    vi.stubEnv("ENVIRONMENT", "beta");
    vi.stubEnv("EXPLORE_GUILD_ALLOWLIST", "100000000000000001");
    resetConfigurationForTests();
    expect(listGuildsWithFlagEnabled("dares_enabled").length).toBeGreaterThan(
      0,
    );
    const byCommand = new Map(
      guildScopedCommandGroups.map((group) => [
        group.payload.map((command) => command.name).join(","),
        group.enabledGuildIds(),
      ]),
    );
    expect(byCommand.get("dare")?.length).toBeGreaterThan(0);
    // The /scout registration set is the union of its per-feature gates: the
    // Explore allowlist plus every voice_assistant_enabled guild.
    expect(byCommand.get("scout")).toEqual([
      "100000000000000001",
      ...listGuildsWithFlagEnabled("voice_assistant_enabled"),
    ]);
  });

  test("defines /scout ask with the Explore question bounds and an optional image", () => {
    const scout = guildScopedCommandGroups
      .flatMap((group) => group.payload)
      .find((command) => command.name === "scout");
    expect(scout).toEqual(
      expect.objectContaining({
        name: "scout",
        options: expect.arrayContaining([
          expect.objectContaining({
            name: "ask",
            options: [
              expect.objectContaining({
                name: "question",
                required: true,
                min_length: 1,
                max_length: 2000,
              }),
              // Discord's attachment option type.
              expect.objectContaining({
                name: "image",
                type: 11,
                required: false,
              }),
            ],
          }),
        ]),
      }),
    );
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

describe("guild /scout payload merge", () => {
  test("defines /scout join and /scout leave without options", () => {
    const scout = guildScopedCommandGroups
      .flatMap((group) => group.payload)
      .find((command) => command.name === "scout");
    const names = optionNames(scout);
    expect(names).toEqual(["ask", "join", "leave"]);
  });

  test("keeps global-only fields out of beta's guild /scout payload", () => {
    const scout = guildScopedCommandGroups
      .flatMap((group) => group.payload)
      .find((command) => command.name === "scout");
    const wirePayload = JSON.stringify(scout);
    expect(wirePayload).not.toContain('"contexts"');
    expect(wirePayload).not.toContain('"integration_types"');
  });

  test("merges per-feature gates into one per-guild /scout payload", async () => {
    vi.stubEnv("ENVIRONMENT", "beta");
    vi.stubEnv("EXPLORE_GUILD_ALLOWLIST", "100000000000000001");
    resetConfigurationForTests();

    // Explore-only guild: /scout carries ask alone — no dead voice entries.
    const exploreOnly = await guildCommandPayload(
      DiscordGuildIdSchema.parse("100000000000000001"),
    );
    const exploreScout = exploreOnly.find(
      (command) => command.name === "scout",
    );
    expect(optionNames(exploreScout)).toEqual(["ask"]);

    // Voice-flag guild (also Explore-allowlisted? not here): join/leave only.
    const voiceGuild = listGuildsWithFlagEnabled("voice_assistant_enabled")[0];
    if (voiceGuild === undefined) {
      throw new Error("voice_assistant_enabled must target the beta guild");
    }
    const voiceOnly = await guildCommandPayload(voiceGuild);
    const voiceScout = voiceOnly.find((command) => command.name === "scout");
    expect(optionNames(voiceScout)).toEqual(["join", "leave"]);

    // Both gates on: the full merge, ask first.
    vi.stubEnv("EXPLORE_GUILD_ALLOWLIST", voiceGuild);
    resetConfigurationForTests();
    const merged = await guildCommandPayload(voiceGuild);
    const mergedScout = merged.find((command) => command.name === "scout");
    expect(optionNames(mergedScout)).toEqual(["ask", "join", "leave"]);

    // Neither gate: no /scout registration at all.
    vi.stubEnv("EXPLORE_GUILD_ALLOWLIST", "");
    resetConfigurationForTests();
    const neither = await guildCommandPayload(
      DiscordGuildIdSchema.parse("300000000000000003"),
    );
    expect(neither.map((command) => command.name)).not.toContain("scout");
  });
});
