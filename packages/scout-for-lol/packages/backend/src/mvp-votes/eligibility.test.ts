import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  MY_SERVER,
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  hasTrackedSideForMvpVotes,
  shouldAttachMvpVotes,
} from "#src/mvp-votes/eligibility.ts";

const OTHER_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");
const originalEnvironment = Bun.env["ENVIRONMENT"];

function puuid(index: number) {
  return LeaguePuuidSchema.parse(
    `p${index.toString().padStart(2, "0")}`.padEnd(78, "x"),
  );
}

function tenParticipants() {
  return Array.from({ length: 10 }, (_, index) => ({
    puuid: puuid(index),
    teamId: index < 5 ? 100 : 200,
  }));
}

function threeBlueTracked() {
  return [puuid(0), puuid(1), puuid(2)];
}

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

describe("hasTrackedSideForMvpVotes", () => {
  test("requires three tracked players on one team", () => {
    const participants = tenParticipants();
    expect(
      hasTrackedSideForMvpVotes({
        participants,
        trackedPuuids: [puuid(0), puuid(1)],
      }),
    ).toBe(false);
    expect(
      hasTrackedSideForMvpVotes({
        participants,
        trackedPuuids: [puuid(0), puuid(1), puuid(5), puuid(6)],
      }),
    ).toBe(false);
    expect(
      hasTrackedSideForMvpVotes({
        participants,
        trackedPuuids: threeBlueTracked(),
      }),
    ).toBe(true);
    expect(
      hasTrackedSideForMvpVotes({
        participants,
        trackedPuuids: [puuid(0), puuid(1), puuid(5), puuid(6), puuid(7)],
      }),
    ).toBe(true);
  });
});

describe("shouldAttachMvpVotes", () => {
  test("solo queues never attach furniture", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: MY_SERVER });
    await expect(
      shouldAttachMvpVotes({
        queueType: "solo",
        targetGuildIds: [MY_SERVER],
        participants: tenParticipants(),
        trackedPuuids: threeBlueTracked(),
      }),
    ).resolves.toBe(false);
  });

  test("clash never attaches furniture", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: MY_SERVER });
    await expect(
      shouldAttachMvpVotes({
        queueType: "clash",
        targetGuildIds: [MY_SERVER],
        participants: tenParticipants(),
        trackedPuuids: threeBlueTracked(),
      }),
    ).resolves.toBe(false);
  });

  test("flex attaches only when every audience guild has the flag", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: MY_SERVER });
    await expect(
      shouldAttachMvpVotes({
        queueType: "flex",
        targetGuildIds: [OTHER_GUILD, MY_SERVER],
        participants: tenParticipants(),
        trackedPuuids: threeBlueTracked(),
      }),
    ).resolves.toBe(false);
    await expect(
      shouldAttachMvpVotes({
        queueType: "flex",
        targetGuildIds: [MY_SERVER],
        participants: tenParticipants(),
        trackedPuuids: threeBlueTracked(),
      }),
    ).resolves.toBe(true);
  });

  test("ranked 5s attaches when the flag and a tracked side are present", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: MY_SERVER });
    await expect(
      shouldAttachMvpVotes({
        queueType: "ranked 5s",
        targetGuildIds: [MY_SERVER],
        participants: tenParticipants(),
        trackedPuuids: threeBlueTracked(),
      }),
    ).resolves.toBe(true);
  });

  test("ranked 5-stacks stay off without three tracked players on one team", async () => {
    addFlagOverride("mvp_votes_enabled", true, { server: MY_SERVER });
    await expect(
      shouldAttachMvpVotes({
        queueType: "flex",
        targetGuildIds: [MY_SERVER],
        participants: tenParticipants(),
        trackedPuuids: [puuid(0), puuid(1), puuid(5), puuid(6)],
      }),
    ).resolves.toBe(false);
    await expect(
      shouldAttachMvpVotes({
        queueType: "ranked 5s",
        targetGuildIds: [MY_SERVER],
        participants: tenParticipants(),
        trackedPuuids: [puuid(0), puuid(1)],
      }),
    ).resolves.toBe(false);
  });

  test("flex stays off when no audience guild has the flag", async () => {
    await expect(
      shouldAttachMvpVotes({
        queueType: "flex",
        targetGuildIds: [OTHER_GUILD],
        participants: tenParticipants(),
        trackedPuuids: threeBlueTracked(),
      }),
    ).resolves.toBe(false);
  });
});
