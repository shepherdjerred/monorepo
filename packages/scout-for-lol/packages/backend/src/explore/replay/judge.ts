import { z } from "zod";
import { numericClaims } from "#src/explore/replay/diff.ts";
import type { ChipExpectation } from "#src/explore/replay/profiles.ts";

/**
 * Grading a replayed answer on quality, which no other number here measures.
 *
 * The replay bundle deliberately has no quality verdict: `passed` means every
 * case ran and the configuration was what it claimed, and the signals are
 * triage aids that rank cases for a person to read. That was the right call
 * while a person read every sweep, and it is why "did this change make Explore
 * better" has had no answer — only two summaries to eyeball side by side.
 *
 * This module supplies one. It grades stored bundles offline, so a rubric
 * change re-scores every bundle ever written without a model call against the
 * agent — the same property `scoreCase` has, and for the same reason: the
 * evidence is expensive and the judgement is not.
 *
 * The division of labour matters. The judge model returns *observations* about
 * one answer; the arithmetic that turns observations into a score lives here,
 * in code, under test. A model asked for a number would drift between runs and
 * nothing would pin it. `capability-eval.ts` states the same rule for the same
 * reason: assertions inside the script that calls the model are never tested.
 */

export const EXPLORE_JUDGE_MODEL = "gpt-5.6-luna";

/**
 * What the judge is asked to observe, and nothing more.
 *
 * Every field is a closed enum rather than prose, because a rubric that reads
 * free text has no stable meaning across runs. `notes` exists only so a person
 * auditing the judge can see its reasoning; nothing scores it.
 */
export const JudgeObservationSchema = z
  .strictObject({
    /**
     * Did the answer engage the question at all?
     *
     * `deflected` is the third state that matters: an answer that neither
     * answers nor says it cannot is the one a reader has to re-read to
     * classify, and it is what a clarifying question looks like when the user
     * asked something concrete.
     */
    addressed: z.enum(["answered", "declined", "deflected"]),
    /**
     * Are the figures in the answer traceable to a query that returned rows?
     *
     * `not_applicable` when the answer states no figures at all, which is the
     * normal shape of an honest decline.
     */
    grounded: z.enum(["grounded", "unsupported", "not_applicable"]),
    /**
     * Did it claim Scout *lacks* data, rather than that this surface cannot
     * reach it?
     *
     * The distinction this whole dimension exists for: the prod lake holds
     * 229,330 ban rows and 25 million timeline events, and Explore told users
     * "its lobby data records champion selections, not bans". That answer is
     * phrased with approved refusal vocabulary, so the capability eval passes
     * it. It is still false about Scout.
     */
    coverageHonesty: z.enum([
      "honest",
      "overclaimed_absence",
      "not_applicable",
    ]),
    /**
     * When a feature is gated off for this guild, was that the stated reason?
     *
     * A gated feature refused for an invented data limit teaches the user the
     * wrong thing: they go away believing Scout cannot do it at all, when
     * their admin could switch it on.
     */
    refusalKind: z.enum(["correct", "wrong_reason", "not_applicable"]),
    notes: z.string().max(600),
  })
  .strict();

export type JudgeObservation = z.infer<typeof JudgeObservationSchema>;

/**
 * What a case lost marks for, in the judge's own words.
 *
 * Kept as labels rather than a bare number so a score can be explained without
 * re-reading the bundle, and so a rubric change is visible as a change in
 * which labels appear rather than only in the total.
 */
export const JUDGE_FAILURES = [
  /** Figures the answer asserts that no query supports. */
  "unsupported_figures",
  /** Said Scout does not hold data Scout holds. */
  "overclaimed_absence",
  /** A gated feature refused for some reason other than the gating. */
  "wrong_refusal_reason",
  /** Neither answered nor said it could not. */
  "deflected",
  /** Declined a question this guild's capabilities cover. */
  "declined_within_reach",
  /** Answered as if a gated feature were available. */
  "answered_while_gated",
] as const;

export type JudgeFailure = (typeof JUDGE_FAILURES)[number];

/**
 * How much each failure costs, out of 100.
 *
 * Ordered by how badly the answer misleads someone who trusts it. Asserting a
 * figure nothing supports and asserting Scout lacks data it holds are the two
 * that leave a reader with a false belief, so they cost most; a decline that
 * is honest but unhelpful costs least, because the reader is merely no better
 * off. A case can collect several, and the total floors at zero rather than
 * going negative — a very bad answer is bad, not arbitrarily bad.
 */
const FAILURE_COST: Readonly<Record<JudgeFailure, number>> = {
  unsupported_figures: 60,
  overclaimed_absence: 50,
  answered_while_gated: 45,
  wrong_refusal_reason: 25,
  deflected: 25,
  declined_within_reach: 20,
};

export type CaseGrade = {
  readonly score: number;
  readonly failures: readonly JudgeFailure[];
};

/**
 * Turn one set of observations into a grade, given what the chip was supposed
 * to do for this guild.
 *
 * `expectation` is what keeps this from grading "did it answer": a chip whose
 * feature is switched off for this guild is *supposed* to decline, and scoring
 * that as a failure would reward a harness that leaks gated features.
 */
export function gradeCase(input: {
  readonly observation: JudgeObservation;
  /** Null for a conversation turn, which carries no chip expectation. */
  readonly expectation: ChipExpectation | null;
}): CaseGrade {
  const { observation, expectation } = input;
  const failures: JudgeFailure[] = [];

  if (observation.grounded === "unsupported") {
    failures.push("unsupported_figures");
  }
  if (observation.coverageHonesty === "overclaimed_absence") {
    failures.push("overclaimed_absence");
  }
  if (observation.refusalKind === "wrong_reason") {
    failures.push("wrong_refusal_reason");
  }
  if (observation.addressed === "deflected") {
    failures.push("deflected");
  }

  // `either` asserts nothing in the signal grader and asserts nothing here;
  // a conversation turn has no expectation at all.
  if (expectation === "answerable" && observation.addressed === "declined") {
    failures.push("declined_within_reach");
  }
  if (expectation === "gated-off" && observation.addressed === "answered") {
    failures.push("answered_while_gated");
  }

  const cost = failures.reduce(
    (total, failure) => total + FAILURE_COST[failure],
    0,
  );
  return { score: Math.max(0, 100 - cost), failures };
}

export type JudgedCase = {
  readonly caseId: string;
  readonly condition: string | null;
  readonly expectation: ChipExpectation | null;
  readonly observation: JudgeObservation;
  readonly grade: CaseGrade;
};

export type BundleScore = {
  readonly cases: number;
  /** Mean case score, rounded to one decimal. */
  readonly score: number;
  /** Cases with no failures at all. */
  readonly clean: number;
  readonly failureTally: readonly {
    readonly failure: JudgeFailure;
    readonly count: number;
  }[];
};

/**
 * The bundle-level number, and the tally that explains it.
 *
 * A mean rather than a pass rate: a pass rate would need a threshold, and no
 * threshold here would mean anything — the point is to compare two runs of the
 * same corpus, not to declare a bundle good. The tally is reported beside it
 * because the mean alone cannot say whether a drop came from one catastrophic
 * case or twenty mediocre ones.
 */
export function scoreBundle(judged: readonly JudgedCase[]): BundleScore {
  if (judged.length === 0) {
    return { cases: 0, score: 0, clean: 0, failureTally: [] };
  }
  const total = judged.reduce((sum, entry) => sum + entry.grade.score, 0);
  const counts = new Map<JudgeFailure, number>();
  for (const entry of judged) {
    for (const failure of entry.grade.failures) {
      counts.set(failure, (counts.get(failure) ?? 0) + 1);
    }
  }
  return {
    cases: judged.length,
    score: Math.round((total / judged.length) * 10) / 10,
    clean: judged.filter((entry) => entry.grade.failures.length === 0).length,
    failureTally: [...counts.entries()]
      .map(([failure, count]) => ({ failure, count }))
      .toSorted((left, right) => right.count - left.count),
  };
}

/**
 * The evidence one case hands the judge.
 *
 * Only what the bundle already stores. The judge never re-runs the agent and
 * never sees a "correct answer" — there is none for most of these questions,
 * and inventing one is how a rubric starts measuring the rubric's author.
 */
export type JudgeCaseInput = {
  readonly question: string;
  readonly answer: string | null;
  readonly queryText: string | null;
  readonly rowsReturned: number | null;
  readonly toolNames: readonly string[];
  readonly expectation: ChipExpectation | null;
  /** Which features this guild actually has, so gating can be judged. */
  readonly capabilities: Readonly<Record<string, boolean>>;
};

/**
 * What Scout holds that Explore's query surface cannot reach.
 *
 * Given to the judge so "Scout does not record bans" can be recognised as
 * false. Without this the judge has no way to tell an honest reachability
 * limit from a claim about Scout's data, which is the whole point of the
 * `coverageHonesty` dimension.
 *
 * Kept as prose rather than a table because it is a prompt, and because the
 * authoritative list is the lake column model — this is a reminder, not a
 * second source of truth.
 */
export const LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH = [
  "champion bans per match (match_team_bans)",
  "objective event timings — dragon, baron, herald, towers, inhibitors (timeline_events)",
  "per-minute gold, XP and CS for every participant (timeline_participant_frames)",
  "team-level objective counts and first-objective flags (match_teams)",
  "item purchases and skill order (timeline_events)",
] as const;

const JUDGE_SYSTEM_PROMPT = [
  "You grade one answer produced by Scout's Explore agent, a tool-using assistant over League of Legends match data.",
  "",
  "You are not asked whether the answer is the one you would have written. You observe four things and nothing else.",
  "",
  "1. addressed — did it answer the question, decline it, or deflect?",
  "   'deflected' means it neither answered nor said it could not: a clarifying question in response to a concrete request deflects.",
  "",
  "2. grounded — are the figures traceable to the query result shown to you?",
  "   'unsupported' when the answer states numbers that no query could have produced, including a query that returned zero rows.",
  "   'not_applicable' when the answer states no figures.",
  "   A wrong formula presented as a real statistic is 'unsupported'.",
  "",
  "3. coverageHonesty — did it claim Scout LACKS data that Scout actually holds?",
  "   Scout's data lake holds the following, which Explore's query language cannot currently reach:",
  ...LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH.map((entry) => `     - ${entry}`),
  "   Saying 'I cannot query that from here' about these is HONEST.",
  "   Saying 'Scout does not record that' about these is 'overclaimed_absence' — it is false about Scout.",
  "   'not_applicable' when the answer makes no claim about what Scout holds.",
  "",
  "4. refusalKind — if a feature is switched off for this guild, was the gating the stated reason?",
  "   'wrong_reason' when it refused a gated feature by blaming missing data instead.",
  "   'not_applicable' when nothing relevant was gated off, or it did not refuse.",
  "",
  "Answer only with the structured observation. Keep notes under 60 words.",
].join("\n");

export function judgeSystemPrompt(): string {
  return JUDGE_SYSTEM_PROMPT;
}

export function judgePromptSha256(): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JUDGE_SYSTEM_PROMPT);
  return hasher.digest("hex");
}

/**
 * The case, rendered for the judge.
 *
 * The figures the answer asserts are extracted here rather than left for the
 * judge to spot, because `numericClaims` already does it deterministically and
 * a model counting numbers is a model that will miscount one.
 */
export function judgeUserPrompt(input: JudgeCaseInput): string {
  const gatedOff = Object.entries(input.capabilities)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name);
  const figures = [...numericClaims(input.answer)];
  return [
    `QUESTION: ${input.question}`,
    "",
    `FEATURES OFF FOR THIS GUILD: ${gatedOff.length === 0 ? "(none)" : gatedOff.join(", ")}`,
    `THIS CHIP WAS EXPECTED TO BE: ${input.expectation ?? "(no expectation — a conversation turn)"}`,
    "",
    `QUERY THE AGENT RAN: ${input.queryText ?? "(no query)"}`,
    `ROWS THAT QUERY RETURNED: ${input.rowsReturned === null ? "(none recorded)" : input.rowsReturned.toString()}`,
    `TOOLS CALLED: ${input.toolNames.length === 0 ? "(none)" : input.toolNames.join(", ")}`,
    "",
    `FIGURES THE ANSWER ASSERTS: ${figures.length === 0 ? "(none)" : figures.join(", ")}`,
    "",
    "ANSWER:",
    input.answer ?? "(the turn produced no answer)",
  ].join("\n");
}

export const ExploreJudgeReportSchema = z
  .strictObject({
    version: z.literal(1),
    bundleRunId: z.string().min(1),
    stage: z.enum(["beta", "prod"]),
    profile: z.string().min(1),
    judgeModel: z.string().min(1),
    judgePromptSha256: z.string().regex(/^[0-9a-f]{64}$/),
    generatedAt: z.iso.datetime(),
    bundle: z.object({
      cases: z.number().int().nonnegative(),
      score: z.number(),
      clean: z.number().int().nonnegative(),
      failureTally: z.array(
        z.object({ failure: z.enum(JUDGE_FAILURES), count: z.number().int() }),
      ),
    }),
    cases: z.array(
      z.object({
        caseId: z.string().min(1),
        condition: z.string().nullable(),
        expectation: z.enum(["answerable", "gated-off", "either"]).nullable(),
        score: z.number(),
        failures: z.array(z.enum(JUDGE_FAILURES)),
        observation: JudgeObservationSchema,
      }),
    ),
    /**
     * Whether the judging run itself completed, not whether Explore is good.
     *
     * The same discipline `passed` follows in a replay summary: this says the
     * judge graded every case it was given. The score is the quality number,
     * and it deliberately has no threshold.
     */
    passed: z.boolean(),
  })
  .strict();

export type ExploreJudgeReport = z.infer<typeof ExploreJudgeReportSchema>;
