import { describe, expect, test } from "bun:test";
import {
  commandDefinitions,
  guildScopedCommandGroups,
} from "#src/discord/commands/definitions.ts";
import {
  getFlag,
  listGuildsWithFlagEnabled,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

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
    for (const name of guildScopedNames) {
      expect(globalNames).not.toContain(name);
    }
  });

  test("registers each guild-scoped command only where its flag is on", () => {
    for (const group of guildScopedCommandGroups) {
      // Another test file may have cleared this flag; the registry is shared.
      resetFlagOverrides(group.flag);
      const guilds = listGuildsWithFlagEnabled(group.flag);
      // A group that resolves to no guilds would silently register nowhere,
      // which looks identical to the feature being broken.
      expect(guilds.length).toBeGreaterThan(0);
      for (const guildId of guilds) {
        expect(getFlag(group.flag, { server: guildId })).toBe(true);
      }
    }
  });

  test("does not register autocomplete options", () => {
    expect(
      commandDefinitions.flatMap((command) =>
        "options" in command ? command.options : [],
      ),
    ).not.toContainEqual(expect.objectContaining({ autocomplete: true }));
  });
});
