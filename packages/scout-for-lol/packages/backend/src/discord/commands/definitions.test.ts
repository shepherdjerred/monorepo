import { describe, expect, test } from "bun:test";
import { commandDefinitions } from "#src/discord/commands/definitions.ts";

describe("registered Discord commands", () => {
  test("exposes only the web-first command surface", () => {
    // The seven web-first commands, plus `bb`.
    //
    // `bb` is a deliberate, owner-approved exception to the "management lives
    // in the dashboard" rule rather than a crack in it: Bryan Bucks is gated to
    // a single guild by the `betting_enabled` flag, and a balance you cannot
    // check from the same place you place a bet is not usable. Adding anything
    // else here still needs the same explicit decision.
    expect(commandDefinitions.map((command) => command.name)).toEqual([
      "help",
      "setup",
      "status",
      "invite",
      "docs",
      "track",
      "list",
      "bb",
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
