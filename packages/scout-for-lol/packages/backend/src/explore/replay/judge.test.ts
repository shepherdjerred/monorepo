import { describe, expect, test } from "vitest";
import {
  JUDGE_FAILURES,
  JudgeObservationSchema,
  gradeCase,
  judgePromptSha256,
  judgeSystemPrompt,
  judgeUserPrompt,
  scoreBundle,
  type JudgeFailure,
  type JudgeObservation,
  type JudgedCase,
} from "./judge.ts";
import type { ChipExpectation } from "./profiles.ts";

function observation(
  overrides: Partial<JudgeObservation> = {},
): JudgeObservation {
  return {
    addressed: "answered",
    grounded: "grounded",
    coverageHonesty: "not_applicable",
    refusalKind: "not_applicable",
    notes: "",
    ...overrides,
  };
}

describe("JudgeObservationSchema", () => {
  test("rejects a value outside the closed vocabulary", () => {
    // Free text would have no stable meaning between runs, which is the whole
    // reason every dimension is an enum.
    expect(() =>
      JudgeObservationSchema.parse({ ...observation(), addressed: "maybe" }),
    ).toThrow();
  });

  test("rejects unknown dimensions rather than ignoring them", () => {
    expect(() =>
      JudgeObservationSchema.parse({ ...observation(), vibes: "good" }),
    ).toThrow();
  });
});

describe("gradeCase", () => {
  test("a grounded answer to an answerable chip is perfect", () => {
    const grade = gradeCase({
      observation: observation(),
      expectation: "answerable",
    });
    expect(grade).toEqual({ score: 100, failures: [] });
  });

  test("an honest decline of a gated feature is perfect", () => {
    // The harness must never reward leaking a gated feature, so declining one
    // is the right answer and scores as such.
    const grade = gradeCase({
      observation: observation({
        addressed: "declined",
        grounded: "not_applicable",
        coverageHonesty: "honest",
        refusalKind: "correct",
      }),
      expectation: "gated-off",
    });
    expect(grade).toEqual({ score: 100, failures: [] });
  });

  test("answering a gated feature is the leak the prod sweep found", () => {
    // Verbatim shape of "Draft a dare for our mid laner" answered with dares
    // switched off.
    const grade = gradeCase({
      observation: observation({ grounded: "not_applicable" }),
      expectation: "gated-off",
    });
    expect(grade.failures).toEqual(["answered_while_gated"]);
    expect(grade.score).toBe(55);
  });

  test("claiming Scout lacks data it holds is penalised heavily", () => {
    // "its lobby data records champion selections, not bans" — against a lake
    // holding 229,330 ban rows.
    const grade = gradeCase({
      observation: observation({
        addressed: "declined",
        grounded: "not_applicable",
        coverageHonesty: "overclaimed_absence",
      }),
      expectation: "answerable",
    });
    expect(grade.failures).toContain("overclaimed_absence");
    expect(grade.failures).toContain("declined_within_reach");
    expect(grade.score).toBe(30);
  });

  test("an honest reachability decline costs far less than a false one", () => {
    const honest = gradeCase({
      observation: observation({
        addressed: "declined",
        grounded: "not_applicable",
        coverageHonesty: "honest",
      }),
      expectation: "answerable",
    });
    const dishonest = gradeCase({
      observation: observation({
        addressed: "declined",
        grounded: "not_applicable",
        coverageHonesty: "overclaimed_absence",
      }),
      expectation: "answerable",
    });
    expect(honest.score).toBeGreaterThan(dishonest.score);
    expect(honest.failures).toEqual(["declined_within_reach"]);
  });

  test("a figure no query supports is the worst single failure", () => {
    // The "Utility has the highest kill participation: 36.7%" case: a wrong
    // formula presented as a real statistic.
    const grade = gradeCase({
      observation: observation({ grounded: "unsupported" }),
      expectation: "answerable",
    });
    expect(grade.failures).toEqual(["unsupported_figures"]);
    expect(grade.score).toBe(40);
  });

  test("a clarifying question to a concrete request deflects", () => {
    const grade = gradeCase({
      observation: observation({
        addressed: "deflected",
        grounded: "not_applicable",
      }),
      expectation: "answerable",
    });
    expect(grade.failures).toEqual(["deflected"]);
  });

  test("asserts nothing for an `either` chip or a conversation turn", () => {
    for (const expectation of ["either", null] as const) {
      const declined = gradeCase({
        observation: observation({
          addressed: "declined",
          grounded: "not_applicable",
          coverageHonesty: "honest",
        }),
        expectation,
      });
      expect(declined.failures).toEqual([]);
    }
  });

  test("collects several failures and floors at zero", () => {
    const grade = gradeCase({
      observation: observation({
        addressed: "deflected",
        grounded: "unsupported",
        coverageHonesty: "overclaimed_absence",
        refusalKind: "wrong_reason",
      }),
      expectation: "gated-off",
    });
    expect(grade.failures).toHaveLength(4);
    // 60 + 50 + 25 + 25 exceeds 100; a very bad answer is bad, not negative.
    expect(grade.score).toBe(0);
  });

  test("every failure label has a cost", () => {
    // A label with no cost would be recorded and then silently ignored.
    const provoke: Readonly<
      Record<
        JudgeFailure,
        { observation: Partial<JudgeObservation>; expectation: ChipExpectation }
      >
    > = {
      unsupported_figures: {
        observation: { grounded: "unsupported" },
        expectation: "answerable",
      },
      overclaimed_absence: {
        observation: { coverageHonesty: "overclaimed_absence" },
        expectation: "answerable",
      },
      wrong_refusal_reason: {
        observation: { refusalKind: "wrong_reason" },
        expectation: "answerable",
      },
      deflected: {
        observation: { addressed: "deflected" },
        expectation: "answerable",
      },
      declined_within_reach: {
        observation: { addressed: "declined" },
        expectation: "answerable",
      },
      answered_while_gated: {
        observation: { addressed: "answered" },
        expectation: "gated-off",
      },
    };

    for (const failure of JUDGE_FAILURES) {
      const setup = provoke[failure];
      const scored = gradeCase({
        observation: observation(setup.observation),
        expectation: setup.expectation,
      });
      expect(scored.failures).toContain(failure);
      expect(scored.score).toBeLessThan(100);
    }
  });
});

function judged(overrides: Partial<JudgedCase> = {}): JudgedCase {
  const base: JudgedCase = {
    caseId: "chip:aaaaaaaaaaaa",
    condition: "always",
    expectation: "answerable",
    observation: observation(),
    grade: { score: 100, failures: [] },
  };
  return { ...base, ...overrides };
}

describe("scoreBundle", () => {
  test("is the mean of its cases, to one decimal", () => {
    const score = scoreBundle([
      judged(),
      judged({ grade: { score: 40, failures: ["unsupported_figures"] } }),
      judged({ grade: { score: 55, failures: ["answered_while_gated"] } }),
    ]);
    expect(score.cases).toBe(3);
    expect(score.score).toBe(65);
    expect(score.clean).toBe(1);
  });

  test("tallies failures so a drop can be explained", () => {
    // A mean alone cannot say whether a fall came from one catastrophe or
    // twenty mediocre cases.
    const score = scoreBundle([
      judged({ grade: { score: 50, failures: ["overclaimed_absence"] } }),
      judged({ grade: { score: 50, failures: ["overclaimed_absence"] } }),
      judged({ grade: { score: 40, failures: ["unsupported_figures"] } }),
    ]);
    expect(score.failureTally).toEqual([
      { failure: "overclaimed_absence", count: 2 },
      { failure: "unsupported_figures", count: 1 },
    ]);
  });

  test("an empty bundle scores zero rather than dividing by nothing", () => {
    expect(scoreBundle([])).toEqual({
      cases: 0,
      score: 0,
      clean: 0,
      failureTally: [],
    });
  });
});

describe("the judge prompt", () => {
  test("names the data Scout holds that ScoutQL cannot reach", () => {
    // Without this the judge cannot tell an honest reachability limit from a
    // false claim about Scout, which is the dimension it exists for.
    const prompt = judgeSystemPrompt();
    expect(prompt).toContain("match_team_bans");
    expect(prompt).toContain("timeline_events");
    expect(prompt).toContain("timeline_participant_frames");
    expect(prompt).toContain("overclaimed_absence");
  });

  test("its hash changes when the rubric does, so reports stay comparable", () => {
    expect(judgePromptSha256()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("hands the judge the figures rather than asking it to count", () => {
    const rendered = judgeUserPrompt({
      question: "Which champions have the highest ban rate?",
      answer: "Yasuo at 54% across 210 games.",
      queryText: null,
      rowsReturned: null,
      toolNames: [],
      expectation: "answerable",
      capabilities: { bucks: true, dares: false },
    });
    expect(rendered).toContain("FIGURES THE ANSWER ASSERTS: 54, 210");
    expect(rendered).toContain("FEATURES OFF FOR THIS GUILD: dares");
    expect(rendered).toContain("QUERY THE AGENT RAN: (no query)");
  });

  test("says plainly when a turn produced no answer", () => {
    const rendered = judgeUserPrompt({
      question: "Compare vision score between our support players",
      answer: null,
      queryText: "from matches select champion",
      rowsReturned: 0,
      toolNames: ["run_report_query"],
      expectation: "answerable",
      capabilities: {},
    });
    expect(rendered).toContain("(the turn produced no answer)");
    expect(rendered).toContain("FEATURES OFF FOR THIS GUILD: (none)");
  });
});
