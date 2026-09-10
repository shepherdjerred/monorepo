import { describe, expect, test } from "vitest";
import {
  parseStoredStatusPhrases,
  statusPhraseCoverageIssues,
  storedStatusPhrasesJson,
} from "#src/betting/dares/presentation/dare-list-copy.ts";

describe("Dare list copy", () => {
  test("round-trips per-game-set English", () => {
    const phrases = {
      support_win: "support wins",
      farm: "games with 8 CS/min",
    };
    expect(parseStoredStatusPhrases(storedStatusPhrasesJson(phrases))).toEqual(
      phrases,
    );
  });

  test("treats a missing column as no authored phrases", () => {
    expect(parseStoredStatusPhrases(null)).toBeNull();
  });

  test("skips coverage when Explore did not author phrases", () => {
    expect(statusPhraseCoverageIssues(["support_win"], undefined)).toEqual([]);
  });

  test("rejects phrases that do not cover the contract's game sets", () => {
    expect(
      statusPhraseCoverageIssues(["support_win", "farm"], {
        support_win: "support wins",
      }),
    ).toEqual(["statusPhrases is missing English for farm."]);
    expect(
      statusPhraseCoverageIssues(["support_win"], {
        support_win: "support wins",
        extra: "bonus",
      }),
    ).toEqual(["statusPhrases names unknown game set extra."]);
  });
});
