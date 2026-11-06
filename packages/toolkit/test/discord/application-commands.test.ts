import { expect, it } from "vitest";
import { ApplicationCommandIndex } from "#lib/discord/application-commands.ts";

it("preserves native command defaults and application/user override metadata", () => {
  const result = ApplicationCommandIndex.parse({
    applications: [
      {
        id: "302050872383242240",
        name: "DISBOARD.org",
        permissions: { channels: { "1043751242649829439": false } },
      },
    ],
    application_commands: [
      {
        id: "123",
        application_id: "302050872383242240",
        name: "bump-settings",
        description: "Settings",
        type: 1,
        default_member_permissions: "8",
        permissions: { user: true },
      },
    ],
  });
  expect(result.applications[0]?.permissions).toEqual({
    channels: { "1043751242649829439": false },
  });
  expect(result.application_commands[0]).toMatchObject({
    default_member_permissions: "8",
    permissions: { user: true },
  });
  expect(() =>
    ApplicationCommandIndex.parse({
      ...result,
      applications: [
        { id: "123", name: "Bot", permissions: { user: "false" } },
      ],
    }),
  ).toThrow();
});
