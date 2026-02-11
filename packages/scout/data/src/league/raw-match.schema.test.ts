/**
 * Unit tests for RawMatch schema validation against real API data
 *
 * These tests verify that our schema correctly validates actual Riot API responses.
 * Test data files contain real match data from the Riot Games API.
 */

import { describe, expect, test } from "bun:test";
import { RawMatchSchema } from "@shepherdjerred/scout-data/league/raw-match.schema";

// Use Bun's path joining to find test data files relative to this test file
// This works both locally and in CI containers
// From packages/data/src/league/ we need to go up to packages/ then to backend/
const baseTestDataPath = `${import.meta.dir}/../../../backend/src/league/model/__tests__/testdata`;

const REAL_MATCH_FILES = [
  `${baseTestDataPath}/matches_2025_09_19_NA1_5370969615.json`,
  `${baseTestDataPath}/matches_2025_09_19_NA1_5370986469.json`,
];

describe("RawMatch Schema Validation", () => {
  test("validates real Arena match data from Riot API", async () => {
    for (const filePath of REAL_MATCH_FILES) {
      const data = JSON.parse(await Bun.file(filePath).text());
      const result = RawMatchSchema.safeParse(data);

      expect(result.success).toBe(true);

      if (result.success) {
        // Verify basic structure
        expect(result.data.metadata).toBeDefined();
        expect(result.data.info).toBeDefined();
        expect(result.data.info.participants).toBeArray();
        expect(result.data.info.participants.length).toBeGreaterThan(0);

        // Verify first participant has challenges
        const firstParticipant = result.data.info.participants[0];
        if (firstParticipant) {
          expect(firstParticipant.challenges).toBeDefined();
        }
      }
    }
  });

  test("schema matches real API data structure", async () => {
    const filePath = REAL_MATCH_FILES[0];
    if (!filePath) {
      throw new Error("No test file path");
    }
    const data = JSON.parse(await Bun.file(filePath).text());
    const result = RawMatchSchema.safeParse(data);

    expect(result.success).toBe(true);

    if (result.success) {
      // Fields that are MISSING in real API but REQUIRED in twisted types
      const firstParticipant = result.data.info.participants[0];
      if (firstParticipant) {
        expect(firstParticipant.baitPings).toBeUndefined(); // Missing in real API
        expect(firstParticipant.bountyLevel).toBeUndefined(); // Missing in real API

        // Fields that ARE present in real API
        expect(firstParticipant.assists).toBeNumber();
        expect(firstParticipant.basicPings).toBeNumber();
        expect(firstParticipant.challenges).toBeDefined();
      }

      // Verify endOfGameResult and tournamentCode are present
      expect(result.data.info.endOfGameResult).toBe("GameComplete");
      expect(result.data.info.tournamentCode).toBe(""); // Empty string in non-tournament matches
    }
  });

  test("challenge fields optionality matches real API", async () => {
    const filePath = REAL_MATCH_FILES[0];
    if (!filePath) {
      throw new Error("No test file path");
    }
    const data = JSON.parse(await Bun.file(filePath).text());
    const result = RawMatchSchema.safeParse(data);

    expect(result.success).toBe(true);

    if (result.success) {
      const firstParticipant = result.data.info.participants[0];
      if (!firstParticipant) {
        throw new Error("No participants found");
      }
      const challenges = firstParticipant.challenges;
      if (!challenges) {
        throw new Error("Challenges data is missing");
      }

      // Fields that ARE present in real API
      expect(challenges.abilityUses).toBeNumber();
      expect(challenges.goldPerMinute).toBeNumber();
      expect(challenges.kda).toBeNumber();

      // Fields that are MISSING in real API Arena matches (should be optional)
      // These fields are not consistently present across all participants:
      expect(challenges.earliestElderDragon).toBeUndefined();
      expect(challenges.fasterSupportQuestCompletion).toBeUndefined();
      expect(challenges.fastestLegendary).toBeUndefined();
      expect(challenges.hadAfkTeammate).toBeUndefined();
      expect(challenges.highestChampionDamage).toBeUndefined();
      expect(challenges.highestCrowdControlScore).toBeUndefined();
      expect(challenges.highestWardKills).toBeUndefined();
      expect(challenges.junglerKillsEarlyJungle).toBeUndefined();
      expect(challenges.killsOnLanersEarlyJungleAsJungler).toBeUndefined();
      expect(challenges.laningPhaseGoldExpAdvantage).toBeUndefined();
      expect(challenges.maxCsAdvantageOnLaneOpponent).toBeUndefined();
      expect(challenges.maxLevelLeadLaneOpponent).toBeUndefined();
      expect(challenges.mythicItemUsed).toBeUndefined();
      expect(challenges.playedChampSelectPosition).toBeUndefined();
      expect(challenges.soloTurretsLategame).toBeUndefined();
      expect(challenges.threeWardsOneSweeperCount).toBeUndefined();
      expect(challenges.visionScoreAdvantageLaneOpponent).toBeUndefined();

      // shortestTimeToAceFromFirstTakedown may be present or undefined depending on participant
      // (present for participant 0, absent for many others)
      expect(
        challenges.shortestTimeToAceFromFirstTakedown === undefined ||
          challenges.shortestTimeToAceFromFirstTakedown > -1,
      ).toBe(true);
    }
  });
});
