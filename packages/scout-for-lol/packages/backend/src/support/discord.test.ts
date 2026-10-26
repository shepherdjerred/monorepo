import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { expect, test } from "vitest";
import { ButtonStyle } from "discord.js";
import { supportContactRow, buildSupportModal } from "#src/support/discord.ts";

test("help and legacy report controls open a bounded private message form with report context", () => {
  const help = supportContactRow().toJSON();
  const report = supportContactRow(
    RiotMatchIdSchema.parse("NA1_1234"),
  ).toJSON();
  expect(help.components[0]).toMatchObject({
    label: "Contact Scout",
    style: ButtonStyle.Secondary,
    custom_id: "support:contact:",
  });
  expect(report.components[0]).toMatchObject({
    label: "Feedback / help",
    custom_id: "support:contact:NA1_1234",
  });
  const modal = buildSupportModal(RiotMatchIdSchema.parse("NA1_1234")).toJSON();
  expect(modal).toMatchObject({
    custom_id: "support:message:NA1_1234",
    title: "Contact Scout privately",
  });
  expect(modal.components[0]).toMatchObject({
    label: "What happened or was confusing?",
    component: { custom_id: "message", max_length: 4000, required: true },
  });
});
