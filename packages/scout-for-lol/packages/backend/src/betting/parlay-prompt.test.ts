import { describe, expect, test } from "vitest";
import {
  ParlayGenerationContextSchema,
  buildParlayProposalPrompt,
} from "#src/betting/parlay-prompt.ts";

const context = ParlayGenerationContextSchema.parse({
  queue: "solo",
  selectedSubjects: ["P1"],
  lobby: Array.from({ length: 10 }, (_unused, index) => ({
    key:
      index === 0
        ? "P1"
        : index < 5
          ? `S${index.toString()}`
          : `O${index.toString()}`,
    team: index < 5 ? "selected" : "opponent",
    champion: `Champion ${index.toString()}`,
    role: "MIDDLE",
    rank: "Gold IV",
    tracked: index === 0,
  })),
  history: [
    {
      subject: "P1",
      overall: {
        available: true,
        games: 30,
        wins: 16,
        averageKills: 6.1,
        averageDeaths: 5.2,
        averageAssists: 8.4,
        averageCreepScore: 181,
      },
      currentChampion: {
        available: true,
        games: 4,
        wins: 3,
        averageKills: 7,
        averageDeaths: 4,
        averageAssists: 9,
        averageCreepScore: 190,
      },
    },
  ],
});

describe("parlay prompt", () => {
  test("renders deterministically with the complete closed catalog", () => {
    const first = buildParlayProposalPrompt(context);
    expect(buildParlayProposalPrompt(context)).toBe(first);
    expect(first).toContain('"participantNumeric"');
    expect(first).toContain('"gameEndedInEarlySurrender"');
    expect(first).toContain("Every selected tracked subject");
    expect(first).toContain("every irrelevant slot to null");
    expect(first).not.toContain("puuid");
  });
});
