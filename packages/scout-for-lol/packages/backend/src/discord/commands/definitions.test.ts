import { afterEach, describe, expect, test } from "vitest";
import {
  commandDefinitions,
  guildScopedCommandGroups,
} from "#src/discord/commands/definitions.ts";
import { listGuildsWithFlagEnabled } from "#src/configuration/flags.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { isPublicBbSubcommand } from "#src/discord/commands/bb.ts";
import { bbCommand } from "#src/discord/commands/bb-definition.ts";

const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  resetConfigurationForTests();
});

describe("registered Discord commands", () => {
  test("exposes only the web-first command surface globally", () => {
    expect(commandDefinitions.map((command) => command.name)).toEqual([
      "help",
      "setup",
      "status",
      "invite",
      "docs",
      "track",
      "list",
    ]);
  });

  test("keeps flag-gated commands out of the global surface", () => {
    // `bb` is registered per guild, so it must not leak into the global list —
    // that would put it in the picker of every guild Scout is in, where it
    // cannot do anything.
    const globalNames = commandDefinitions.map((command) => command.name);
    const guildScopedNames = guildScopedCommandGroups.flatMap((group) =>
      group.payload.map((command) => command.name),
    );

    expect(guildScopedNames).toContain("bb");
    expect(guildScopedNames).toContain("scout");
    for (const name of guildScopedNames) {
      expect(globalNames).not.toContain(name);
    }
  });

  test("resolves flag and Explore guild scopes independently", () => {
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

  test("registers a bounded one-shot /bb ask subcommand that starts private", () => {
    const ask = bbCommand
      .toJSON()
      .options?.find((option) => option.name === "ask");
    if (ask === undefined || !("options" in ask)) {
      throw new Error("/bb ask should be a subcommand with a question option");
    }
    expect(ask.options).toContainEqual(
      expect.objectContaining({
        name: "question",
        required: true,
        min_length: 1,
        max_length: 500,
      }),
    );
    expect(isPublicBbSubcommand("ask")).toBe(false);
    expect(isPublicBbSubcommand("rules")).toBe(true);
    expect(isPublicBbSubcommand("prizes")).toBe(true);
  });

  test("does not register autocomplete options", () => {
    expect(
      commandDefinitions.flatMap((command) =>
        "options" in command ? command.options : [],
      ),
    ).not.toContainEqual(expect.objectContaining({ autocomplete: true }));
  });

  test("defines no redemption, donation, burn, or claim command", () => {
    const registered = [
      ...commandDefinitions.map((command) => command.toJSON()),
      ...guildScopedCommandGroups.flatMap((group) => group.payload),
    ];
    const serialized = JSON.stringify(registered).toLowerCase();

    for (const absent of ["redeem", "redemption", "donate", "burn", "claim"]) {
      expect(serialized).not.toContain(`"name":"${absent}"`);
    }
  });
});
