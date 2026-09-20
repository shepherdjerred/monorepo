import { afterEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { resolveMvpVotesCapability } from "#src/explore/tools/mvp-votes-tools.ts";

const ENABLED_GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const OTHER_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");

afterEach(() => {
  resetFlagOverrides("mvp_votes_enabled");
});

describe("resolveMvpVotesCapability", () => {
  test("returns null when no guild in scope has MVP votes enabled", async () => {
    clearFlagOverrides("mvp_votes_enabled");
    await expect(resolveMvpVotesCapability([OTHER_GUILD])).resolves.toBeNull();
  });

  test("resolves the one enabled guild and ignores the rest of the scope", async () => {
    clearFlagOverrides("mvp_votes_enabled");
    addFlagOverride("mvp_votes_enabled", true, { server: ENABLED_GUILD });
    await expect(
      resolveMvpVotesCapability([OTHER_GUILD, ENABLED_GUILD]),
    ).resolves.toEqual({ serverId: ENABLED_GUILD });
  });

  test("a disabled override does not grant the capability", async () => {
    clearFlagOverrides("mvp_votes_enabled");
    addFlagOverride("mvp_votes_enabled", false, { server: ENABLED_GUILD });
    await expect(
      resolveMvpVotesCapability([ENABLED_GUILD]),
    ).resolves.toBeNull();
  });

  test("more than one enabled guild is a hard failure", async () => {
    clearFlagOverrides("mvp_votes_enabled");
    addFlagOverride("mvp_votes_enabled", true, { server: ENABLED_GUILD });
    addFlagOverride("mvp_votes_enabled", true, { server: OTHER_GUILD });
    await expect(
      resolveMvpVotesCapability([ENABLED_GUILD, OTHER_GUILD]),
    ).rejects.toThrow("exactly one enabled guild");
  });
});
