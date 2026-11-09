import { expect, it } from "vitest";
import { discordCommandPermission } from "./discord-permissions.ts";

const context = {
  administrator: false,
  memberPermissions: "0",
  required: undefined,
  application: undefined,
  command: undefined,
};
it("allows unrestricted native commands without Manage Server", () => {
  expect(discordCommandPermission(context)).toMatchObject({ allowed: true });
  expect(
    discordCommandPermission({ ...context, required: null }),
  ).toMatchObject({ allowed: true });
});
it("refuses missing required bits and explicitly disabled commands", () => {
  expect(
    discordCommandPermission({ ...context, required: "32" }),
  ).toMatchObject({ allowed: false });
  expect(discordCommandPermission({ ...context, required: "0" })).toMatchObject(
    { allowed: false },
  );
  expect(
    discordCommandPermission({
      ...context,
      required: "32",
      memberPermissions: "32",
    }),
  ).toMatchObject({ allowed: true });
});
it("does not silently ignore custom application or command restrictions", () => {
  expect(() =>
    discordCommandPermission({ ...context, application: { user: false } }),
  ).toThrow("unverified");
  expect(() =>
    discordCommandPermission({
      ...context,
      command: { channels: { "123": false } },
    }),
  ).toThrow("unverified");
  expect(
    discordCommandPermission({
      ...context,
      administrator: true,
      command: { user: false },
    }),
  ).toMatchObject({ allowed: true });
});
