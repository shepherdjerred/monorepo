import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  MY_SERVER,
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { shouldAttachFlexMvpVotes } from "#src/mvp-votes/eligibility.ts";

const OTHER_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");
const originalEnvironment = Bun.env["ENVIRONMENT"];

beforeEach(() => {
  Bun.env["ENVIRONMENT"] = "beta";
  resetConfigurationForTests();
});

afterEach(() => {
  resetFlagOverrides("mvp_votes_enabled");
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
  resetConfigurationForTests();
});

describe("shouldAttachFlexMvpVotes", () => {
  test("solo queues never attach furniture", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: MY_SERVER });
    await expect(
      shouldAttachFlexMvpVotes({
        queueType: "solo",
        targetGuildIds: [MY_SERVER],
      }),
    ).resolves.toBe(false);
  });

  test("flex attaches when any audience guild has the flag", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: MY_SERVER });
    await expect(
      shouldAttachFlexMvpVotes({
        queueType: "flex",
        targetGuildIds: [OTHER_GUILD, MY_SERVER],
      }),
    ).resolves.toBe(true);
  });

  test("flex stays off when no audience guild has the flag", async () => {
    await expect(
      shouldAttachFlexMvpVotes({
        queueType: "flex",
        targetGuildIds: [OTHER_GUILD],
      }),
    ).resolves.toBe(false);
  });
});
