import {
  DiscordSmokeScenarioNameSchema,
  discordSmokeStaticOverrides,
} from "#src/discord-smoke-scenarios.ts";
import { expect, test } from "vitest";
test("gateway smoke has no feature overrides and rejects retired scenarios", () => {
  expect(discordSmokeStaticOverrides("gateway")).toEqual({});
  expect(DiscordSmokeScenarioNameSchema.safeParse("bb-transfer").success).toBe(
    false,
  );
});
