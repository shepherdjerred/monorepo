import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { ButtonStyle } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  supportContactRow,
  buildSupportModal,
  withSupportAction,
} from "#src/support/discord.ts";

const server = DiscordGuildIdSchema.parse("100000000000099110");
beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
});
afterAll(async () => {
  resetFlagOverrides("scout_support_conversations_enabled");
  resetFlagOverrides("scout_support_report_action_enabled");
  await shutdownFeatureFlags();
});
test("help and report controls open a bounded private message form with report context", () => {
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
test("a passive action preserves report content and existing controls, and is independently gated", async () => {
  const message = { content: "Report", components: [supportContactRow()] };
  expect(
    await withSupportAction(
      message,
      RiotMatchIdSchema.parse("NA1_1234"),
      server,
    ),
  ).toBe(message);
  addFlagOverride("scout_support_conversations_enabled", true, {});
  expect(
    await withSupportAction(
      message,
      RiotMatchIdSchema.parse("NA1_1234"),
      server,
    ),
  ).toBe(message);
  addFlagOverride("scout_support_report_action_enabled", true, { server });
  const decorated = await withSupportAction(
    message,
    RiotMatchIdSchema.parse("NA1_1234"),
    server,
  );
  expect(decorated.content).toBe(message.content);
  expect(decorated.components).toHaveLength(2);
  expect(decorated.components?.[0]).toBe(message.components[0]);
  expect(message.components).toHaveLength(1);
  expect(
    await withSupportAction(
      message,
      RiotMatchIdSchema.parse("NA1_1234"),
      "100000000000099111",
    ),
  ).toBe(message);
});
test("a full component row leaves the report unchanged", async () => {
  addFlagOverride("scout_support_conversations_enabled", true, {});
  addFlagOverride("scout_support_report_action_enabled", true, { server });
  const message = {
    content: "Report",
    components: Array.from({ length: 5 }, () => supportContactRow()),
  };
  expect(
    await withSupportAction(
      message,
      RiotMatchIdSchema.parse("NA1_1234"),
      server,
    ),
  ).toBe(message);
});
