import { describe, expect, test } from "bun:test";
import { commandDefinitions } from "#src/discord/commands/definitions.ts";

describe("registered Discord commands", () => {
  test("exposes only the web-first command surface", () => {
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

  test("does not register autocomplete options", () => {
    expect(
      commandDefinitions.flatMap((command) =>
        "options" in command ? command.options : [],
      ),
    ).not.toContainEqual(expect.objectContaining({ autocomplete: true }));
  });
});
