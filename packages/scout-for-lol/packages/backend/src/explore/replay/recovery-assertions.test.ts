import { expect, test } from "vitest";
import {
  recoveryAssertions,
  type RecoveryOracle,
} from "./recovery-assertions.ts";

const oracle: RecoveryOracle = {
  buildId: "frozen-build",
  streak: { wins: 4, winners: ["Alice#EUW", "Bob#EUW"] },
  game: {
    matchId: "EUW1_1",
    kda: [11, 7, 8],
    creepScore: 243,
    damage: 46_651,
    gold: 19_991,
    deathEvents: [{ timestampMs: 1_736_570, killer: "Locke" }],
    killers: ["Locke", "Aphelios"],
    teammates: ["Leblanc"],
  },
};
const candidate = {
  answer: "4-win streak in recorded games: Alice and Bob.",
  matchCardIds: [],
  toolNames: ["analyze_javascript"],
};

test("checks independent streak length, ties and recorded scope", () => {
  expect(recoveryAssertions("conv:3c004891:0", candidate, oracle)).toEqual([]);
  expect(
    recoveryAssertions(
      "conv:3c004891:0",
      { ...candidate, answer: "Alice had 5 wins." },
      oracle,
    ),
  ).toEqual(
    expect.arrayContaining([
      "incorrect_or_missing_streak_length",
      "missing_tied_winner:Bob#EUW",
      "missing_recorded_coverage_caveat",
    ]),
  );
});

test("unrecognised numerical wording requires review", () => {
  expect(
    recoveryAssertions(
      "conv:3c004891:0",
      {
        ...candidate,
        answer: "Alice and Bob had four wins in recorded games.",
      },
      oracle,
    ),
  ).toContain("incorrect_or_missing_streak_length");
});

test("recognises the observed equivalent straight-wins wording", () => {
  expect(
    recoveryAssertions(
      "conv:3c004891:0",
      {
        ...candidate,
        answer: "4 straight wins, tied by Alice and Bob in recorded games.",
      },
      oracle,
    ),
  ).toEqual([]);
});

test("recognises an explicit win-streak claim stated in games", () => {
  expect(
    recoveryAssertions(
      "conv:3c004891:0",
      {
        ...candidate,
        answer:
          "The longest recorded win streak is **4 games**, shared by Alice and Bob.",
      },
      oracle,
    ),
  ).toEqual([]);
  expect(
    recoveryAssertions(
      "conv:3c004891:0",
      {
        ...candidate,
        answer:
          "The longest recorded win streak is 5 games, shared by Alice and Bob.",
      },
      oracle,
    ),
  ).toContain("incorrect_or_missing_streak_length");
});

test("rejects the observed friendly champion substitution despite a successful card", () => {
  const game = {
    answer:
      "11/7/8, 243 CS, 46,651 damage, 19,991 gold. LeBlanc killed you three times.",
    matchCardIds: ["EUW1_1"],
    toolNames: ["materialize_raw_documents", "analyze_javascript"],
  };
  expect(recoveryAssertions("conv:507d822f:2", game, oracle)).toEqual([
    "friendly_champion_as_killer:Leblanc",
  ]);
  expect(
    recoveryAssertions(
      "conv:507d822f:2",
      { ...game, answer: game.answer.replace("LeBlanc", "Locke") },
      oracle,
    ),
  ).toEqual([]);
});

test("requires timeline computation and the reviewed card", () => {
  expect(
    recoveryAssertions(
      "conv:507d822f:2",
      {
        answer: "11/7/8, 243 CS, 46651 damage, 19991 gold",
        matchCardIds: [],
        toolNames: [],
      },
      oracle,
    ),
  ).toEqual(["missing_reviewed_match_card", "missing_timeline_analysis"]);
});

test("rejects a misconverted death time while allowing rounded milliseconds", () => {
  const game = {
    answer:
      "11/7/8, 243 CS, 46651 damage, 19991 gold.\n- 28:08 — killed by Locke",
    matchCardIds: ["EUW1_1"],
    toolNames: ["materialize_raw_documents", "summarize_match_timeline"],
  };
  expect(recoveryAssertions("conv:507d822f:2", game, oracle)).toContain(
    "incorrect_death_time:28:08:Locke",
  );
  for (const time of ["28:56", "28:57"])
    expect(
      recoveryAssertions(
        "conv:507d822f:2",
        { ...game, answer: game.answer.replace("28:08", time) },
        oracle,
      ),
    ).toEqual([]);
});
