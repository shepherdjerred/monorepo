import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { competitionCommand } from "#src/discord/commands/competition/index.ts";

const CommandSchema = z.object({
  options: z.array(
    z.object({
      name: z.string(),
      options: z
        .array(
          z.object({
            name: z.string(),
            autocomplete: z.boolean().optional(),
            choices: z.array(z.unknown()).optional(),
          }),
        )
        .optional(),
    }),
  ),
});

function expectSeasonAutocomplete(subcommandName: "create" | "edit"): void {
  const command = CommandSchema.parse(competitionCommand.toJSON());
  const subcommand = command.options.find(
    (option) => option.name === subcommandName,
  );
  if (subcommand === undefined) {
    throw new Error(`Missing ${subcommandName} subcommand`);
  }
  const season = subcommand.options?.find((option) => option.name === "season");
  if (season === undefined) {
    throw new Error(`Missing ${subcommandName} season string option`);
  }
  expect(season.autocomplete).toBe(true);
  expect(season.choices).toBeUndefined();
}

describe("competition command season option", () => {
  test("uses autocomplete when creating a competition", () => {
    expectSeasonAutocomplete("create");
  });

  test("uses autocomplete when editing a competition", () => {
    expectSeasonAutocomplete("edit");
  });
});
