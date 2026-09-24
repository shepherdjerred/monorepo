import { describe, expect, test } from "vitest";
import {
  JUDGE_FAILURES,
  JudgeObservationSchema,
  crashReason,
  gradeCase,
  judgeEvidenceFromTrace,
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
    // Bans left this list when match_team_bans became a source.
    expect(prompt).not.toContain("match_team_bans");
    // Every table is a source now; what remains is the head-to-head shape.
    // Teammate pairings left when player_groups became reachable.
    expect(prompt).toContain("head-to-head");
    expect(prompt).not.toContain("plays well together");
    expect(prompt).not.toContain("timeline_events");
    expect(prompt).not.toContain("timeline_participant_frames");
    expect(prompt).toContain("overclaimed_absence");
  });

  test("its hash changes when the rubric does, so reports stay comparable", () => {
    expect(judgePromptSha256()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("hands the judge the figures rather than asking it to count", () => {
    const rendered = judgeUserPrompt({
      question: "Which champions have the highest ban rate?",
      answer: "Yasuo at 54% across 210 games.",
      queries: [],
      toolResults: [],
      toolNames: [],
      expectation: "answerable",
      capabilities: { bucks: true, dares: false },
    });
    expect(rendered).toContain("FIGURES THE ANSWER ASSERTS: 54, 210");
    expect(rendered).toContain("FEATURES OFF FOR THIS GUILD: dares");
    expect(rendered).toContain("(the turn ran no query)");
  });

  test("says plainly when a turn produced no answer", () => {
    const rendered = judgeUserPrompt({
      question: "Compare vision score between our support players",
      answer: null,
      queries: [{ queryText: "from matches select champion", rowsReturned: 0 }],
      toolResults: [],
      toolNames: ["run_report_query"],
      expectation: "answerable",
      capabilities: {},
    });
    expect(rendered).toContain("(the turn produced no answer)");
    expect(rendered).toContain("FEATURES OFF FOR THIS GUILD: (none)");
  });

  test("separates the user's own numbers from the answer's findings", () => {
    // "Create a competition for most kills across 10 games" was scored
    // unsupported for restating the 10. The judge now reads which figures
    // came from the question instead of having to notice.
    const rendered = judgeUserPrompt({
      question: "Create a competition for most kills across 10 games",
      answer:
        "Competitions are not enabled here. Most kills across 10 games would need an admin to switch them on; the last one ran 14 days.",
      queries: [],
      toolResults: [],
      toolNames: [],
      expectation: "gated-off",
      capabilities: { creation: false },
    });
    expect(rendered).toContain("FIGURES THE QUESTION CONTAINS: 10");
    expect(rendered).toContain("ANSWER FIGURES ALSO IN THE QUESTION: 10");
    expect(rendered).toContain("FIGURES THE ANSWER ASSERTS: 10, 14");
  });

  test("grounds findings in feature-tool output, not only in queries", () => {
    // Six beta answers read straight from list_dares and query_bucks were
    // scored unsupported because the rubric said "unsupported when no query
    // ran" while the evidence it was handed showed the tool result.
    const prompt = judgeSystemPrompt();
    expect(prompt).toContain(
      "A figure a feature tool returned is grounded exactly as one a query returned.",
    );
    expect(prompt).not.toContain("the answer states figures and no query ran");
  });

  test("does not count proposed parameters or examples as findings", () => {
    // A dare's 7-day default and "did you mean 10 PM to 5 AM?" propose or
    // ask; neither reports anything about the data.
    const prompt = judgeSystemPrompt();
    expect(prompt).toContain("Only FINDINGS count");
    expect(prompt).toContain(
      "a deadline, a stake, a game floor, a time window",
    );
    expect(prompt).toContain("an example inside a clarifying question");
  });
});

describe("judgeEvidenceFromTrace", () => {
  test("carries every successful query, not just the last", () => {
    // One case ran four queries returning 25, 1, 5 and 1 rows; showing only one
    // made the judge say "the shown query returns only one role" about a figure
    // a different query produced.
    const evidence = judgeEvidenceFromTrace([
      {
        toolName: "run_report_query",
        status: "succeeded",
        details: { kind: "execution", queryText: "first", rowsReturned: 25 },
      },
      {
        toolName: "run_report_query",
        status: "succeeded",
        details: { kind: "execution", queryText: "second", rowsReturned: 1 },
      },
    ]);
    expect(evidence.queries).toEqual([
      { queryText: "first", rowsReturned: 25 },
      { queryText: "second", rowsReturned: 1 },
    ]);
  });

  test("ignores a failed query, which produced nothing to ground on", () => {
    const evidence = judgeEvidenceFromTrace([
      {
        toolName: "run_report_query",
        status: "failed",
        details: { kind: "execution", queryText: "broken", rowsReturned: null },
      },
    ]);
    expect(evidence.queries).toEqual([]);
  });

  test("surfaces what a feature tool returned", () => {
    // Bucks, dares and MVP answers never touch ScoutQL, so without this the
    // judge sees no evidence and calls them unsupported.
    const evidence = judgeEvidenceFromTrace([
      {
        toolName: "query_bucks_bets",
        status: "succeeded",
        rawOutput: { kind: "value", value: { winRate: 0.6418, bets: 67 } },
      },
    ]);
    expect(evidence.toolResults).toHaveLength(1);
    expect(evidence.toolResults[0]?.toolName).toBe("query_bucks_bets");
    expect(evidence.toolResults[0]?.summary).toContain("0.6418");
  });

  test("bounds a tool result so it cannot crowd out the answer", () => {
    const evidence = judgeEvidenceFromTrace([
      {
        toolName: "get_bucks_dataset",
        status: "succeeded",
        rawOutput: { kind: "value", value: { rows: "x".repeat(4000) } },
      },
    ]);
    expect(evidence.toolResults[0]?.summary.length).toBeLessThanOrEqual(500);
  });

  test("skips an omitted payload rather than inventing one", () => {
    const evidence = judgeEvidenceFromTrace([
      {
        toolName: "query_bucks_ledger",
        status: "succeeded",
        rawOutput: { kind: "omitted", reason: "payload_limit", byteLength: 90 },
      },
    ]);
    expect(evidence.toolResults).toEqual([]);
  });

  test("ignores tools that carry no data, like load_skill", () => {
    const evidence = judgeEvidenceFromTrace([
      {
        toolName: "load_skill",
        status: "succeeded",
        rawOutput: { kind: "value", value: { body: "..." } },
      },
    ]);
    expect(evidence.toolResults).toEqual([]);
  });
});

describe("crashed turns", () => {
  // The prod bundle's one crash was graded `deflected` — a 25-point failure
  // that reads as a model dodging the question, when the turn had fallen over
  // after seven failed validations and produced nothing at all.
  test("a turn with no answer and a recorded error is not gradable", () => {
    expect(crashReason({ candidate: { answer: null }, error: "boom" })).toBe(
      "boom",
    );
  });

  test("an answer beside an error is behaviour, and is graded", () => {
    // A tool failed mid-turn and the agent recovered. Whether the answer owns
    // up to that is exactly what the judge is for.
    expect(
      crashReason({
        candidate: { answer: "Alice has 12 wins." },
        error: "get_clash_schedule failed",
      }),
    ).toBeNull();
  });

  test("no answer and no error stays gradable", () => {
    // Nothing crashed, so an empty answer is a way of responding, and a bad
    // one. Excluding it would hide a real failure behind a harness category.
    expect(crashReason({ candidate: { answer: null } })).toBeNull();
  });

  test("an error that stringifies to nothing still names the case", () => {
    expect(crashReason({ candidate: { answer: null }, error: "" })).toBe(
      "the turn produced no answer",
    );
  });

  test("a non-Error throw is described rather than stringified to [object Object]", () => {
    expect(
      crashReason({ candidate: { answer: null }, error: { code: 500 } }),
    ).toBe('{"code":500}');
  });
});

describe("the judge stays offline", () => {
  // It reads stored bundles and calls one model. Importing anything from the
  // runner gave it the whole agent runtime — and with it a hard requirement
  // for Riot credentials and a Temporal namespace, which turned every
  // re-judge into a configuration error until `describe-thrown.ts` split the
  // one helper they share out of the runner.
  test("imports nothing that pulls in backend configuration", async () => {
    const source = await Bun.file(
      new URL("judge.ts", import.meta.url).pathname,
    ).text();
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map(
      (entry) => entry[1] ?? "",
    );
    expect(imports).not.toContain("#src/explore/replay/runner.ts");
    for (const specifier of imports) {
      expect(specifier).not.toContain("/configuration");
      expect(specifier).not.toContain("/league/");
    }
  });
});
