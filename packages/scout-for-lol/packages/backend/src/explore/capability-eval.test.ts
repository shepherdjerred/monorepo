import { describe, expect, test } from "vitest";
import {
  ExploreCapabilityCorpusSchema,
  type ExploreCapabilityCase,
} from "@scout-for-lol/data";
import corpusJson from "@scout-for-lol/data/model/reports/explore-capability-corpus.json" with { type: "json" };
import { capabilityAnswerIssues } from "#src/explore/capability-eval.ts";

const corpus = ExploreCapabilityCorpusSchema.parse(corpusJson);

function caseById(id: string): ExploreCapabilityCase {
  const entry = corpus.cases.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`No corpus case '${id}'`);
  return entry;
}

describe("the capability corpus", () => {
  test("parses, and covers both creation states", () => {
    expect(corpus.cases.length).toBeGreaterThan(0);
    expect(corpus.cases.some((entry) => entry.creationEnabled)).toBe(true);
    expect(corpus.cases.some((entry) => !entry.creationEnabled)).toBe(true);
  });
});

describe("capabilityAnswerIssues", () => {
  const mostKills = caseById("competition-most-kills");

  test("passes an answer that refuses and names a real criterion", () => {
    expect(
      capabilityAnswerIssues({
        answer:
          "A Scout competition cannot score kills — there is no such criterion. The closest options are Most wins or Highest win rate. Want one of those instead?",
        entry: mostKills,
      }),
    ).toEqual([]);
  });

  test("accepts the curly apostrophe the model actually emits", () => {
    expect(
      capabilityAnswerIssues({
        answer:
          "Scout can’t score kills in a competition. Most wins is the nearest criterion.",
        entry: mostKills,
      }),
    ).toEqual([]);
  });

  test("fails an answer that agrees to build the unsupported thing", () => {
    const issues = capabilityAnswerIssues({
      answer:
        "Sure! I can set up a most-kills competition across 10 recorded games. I just need the participants first.",
      entry: mostKills,
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  test("accepts refusal wordings that match no single literal", () => {
    // Three live runs failed on wording alone before the refusal vocabulary
    // was shared; these are the exact answers they produced.
    for (const answer of [
      "Not as a competition type right now. Scout competitions only support games played, wins, champion wins, win rate, highest rank, and rank climb — not kills.",
      "Competitions can score only games played, wins, win rate, rank, or rank climb, not kills.",
      "Scoring by kills is not supported. Most wins is the nearest criterion.",
    ]) {
      expect(capabilityAnswerIssues({ answer, entry: mostKills })).toEqual([]);
    }
  });

  test("names the missing concept, not the vocabulary, when a refusal is absent", () => {
    const issues = capabilityAnswerIssues({
      answer:
        "Sure, I will set up a kills competition. Most wins is also available.",
      entry: mostKills,
    });
    expect(issues).toEqual(["Said none of: any refusal wording"]);
  });

  test("fails an answer that refuses but names no real criterion", () => {
    const issues = capabilityAnswerIssues({
      answer: "Scout cannot run a competition scored by kills.",
      entry: mostKills,
    });
    expect(issues).toEqual([
      "Said none of: most wins / win rate / games played / highest rank / rank climb",
    ]);
  });

  test("fails an answer that sends the user to a bracket site", () => {
    const issues = capabilityAnswerIssues({
      answer:
        "Scout cannot score kills. Use a bracket tool such as Challonge and track it in a spreadsheet, or ask an organizer to run it.",
      entry: mostKills,
    });
    expect(issues).toContain(
      "Sent the user off Scout, or denied the feature: challonge",
    );
    expect(issues).toContain(
      "Sent the user off Scout, or denied the feature: spreadsheet",
    );
  });

  test("fails an answer that denies the feature exists when creation is off", () => {
    const entry = caseById("competition-creation-disabled");
    const issues = capabilityAnswerIssues({
      answer: "Scout does not have competitions, so I cannot help with that.",
      entry,
    });
    expect(issues).toContain(
      "Sent the user off Scout, or denied the feature: scout does not have competitions",
    );
  });

  test("passes the creation-off answer that points at the web app", () => {
    expect(
      capabilityAnswerIssues({
        answer:
          "Preparing a competition is not enabled for this server, so I cannot create one here. A server admin can set it up on the Scout web app.",
        entry: caseById("competition-creation-disabled"),
      }),
    ).toEqual([]);
  });
});
