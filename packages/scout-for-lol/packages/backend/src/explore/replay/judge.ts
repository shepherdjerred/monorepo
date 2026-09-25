import { z } from "zod";
import { numericClaims } from "#src/explore/replay/diff.ts";
import { describeThrown } from "#src/explore/replay/describe-thrown.ts";
import type { ChipExpectation } from "#src/explore/replay/profiles.ts";
import { LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH } from "#src/explore/lake-coverage.ts";
import { challengeFacts, hallOfFameFacts } from "#src/explore/product-facts.ts";

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

/**
 * Deliberately not the model under test.
 *
 * Explore runs on `gpt-5.6-luna`, and a model is a lenient grader of its own
 * output — most of all on the honesty dimension here, where the judgement is
 * about whether an answer overstated what it knew. Grading luna with luna
 * would fold that bias straight into the only quality number this harness
 * produces.
 *
 * Terra costs ten times luna per token, which does not matter at this shape:
 * the judge makes one short call per case against text already on disk, where
 * a sweep makes many long tool-using turns against a live lake.
 */
export const EXPLORE_JUDGE_MODEL = "gpt-5.6-terra";

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
  /**
   * Every successful query the turn ran, in order, with what each returned.
   *
   * Not one query. An answer commonly synthesises several — one case ran four,
   * returning 25, 1, 5 and 1 rows — and showing the judge only the last made it
   * say "the shown query returns only one role" about a figure a different
   * query had produced. Eight cases failed on exactly that.
   */
  readonly queries: readonly {
    readonly queryText: string | null;
    readonly rowsReturned: number | null;
    /**
     * Whether it read every match or only the user's servers' players. An
     * answer that checks the server, finds nothing, then answers across all
     * matches runs two queries that look alike without it.
     */
    readonly scope: string | null;
  }[];
  /**
   * What the non-ScoutQL tools returned, bounded.
   *
   * Bucks, dares, MVP votes, challenges and Clash answer from their own tools
   * and never touch ScoutQL, so a judge shown only queries sees no evidence at
   * all and calls a well-grounded answer unsupported. Fifteen of beta's
   * thirty-three did precisely that.
   */
  readonly toolResults: readonly {
    readonly toolName: string;
    readonly summary: string;
  }[];
  readonly toolNames: readonly string[];
  readonly expectation: ChipExpectation | null;
  /** Which features this guild actually has, so gating can be judged. */
  readonly capabilities: Readonly<Record<string, boolean>>;
};

/** Tools that answer from their own data rather than through ScoutQL. */
const CAPABILITY_TOOL_PATTERN =
  /^(?:get_bucks|query_bucks|list_dares|inspect_dare|query_mvp|list_challenge|list_my_challenge|preview_challenge|challenge_leaderboard|get_clash|get_hall|list_competitions|get_competition)/;

/**
 * How much of one tool result the judge is shown.
 *
 * Enough to see whether the figures in an answer could have come from it, and
 * bounded because a bucks dataset or a Clash roster is unbounded and would
 * crowd out the answer being judged.
 */
const TOOL_RESULT_MAX_LENGTH = 500;

/**
 * The evidence a stored trace holds, in the shape the judge is shown.
 *
 * Everything here has always been in the bundle. It went unread because the
 * case record's `candidate` carries one query and no tool output at all.
 */
export function judgeEvidenceFromTrace(
  trace: readonly {
    readonly toolName: string;
    readonly status: string;
    readonly details?: unknown;
    readonly rawInput?: unknown;
    readonly rawOutput?: unknown;
  }[],
): Pick<JudgeCaseInput, "queries" | "toolResults"> {
  const queries: JudgeCaseInput["queries"][number][] = [];
  const toolResults: { toolName: string; summary: string }[] = [];

  for (const entry of trace) {
    if (entry.status !== "succeeded") continue;
    if (entry.toolName === "run_report_query") {
      const query = queryEvidence(entry);
      if (query !== null) queries.push(query);
      continue;
    }
    if (!CAPABILITY_TOOL_PATTERN.test(entry.toolName)) continue;
    const output = TraceRawOutputSchema.safeParse(entry.rawOutput);
    if (!output.success || output.data === null) continue;
    if (output.data.kind !== "value") continue;
    toolResults.push({
      toolName: entry.toolName,
      summary: JSON.stringify(output.data.value).slice(
        0,
        TOOL_RESULT_MAX_LENGTH,
      ),
    });
  }

  return { queries, toolResults };
}

/** One executed query as the judge sees it, or null if the trace lacks it. */
function queryEvidence(entry: {
  readonly details?: unknown;
  readonly rawInput?: unknown;
}): JudgeCaseInput["queries"][number] | null {
  const parsed = TraceExecutionSchema.safeParse(entry.details);
  if (!parsed.success) return null;
  const input = TraceQueryScopeSchema.safeParse(entry.rawInput);
  return {
    queryText: parsed.data.queryText ?? null,
    rowsReturned: parsed.data.rowsReturned,
    scope: input.success ? input.data.value.scope : null,
  };
}

/** The scope kind a trace records beside a query; see tool-inspection.ts. */
const TraceQueryScopeSchema = z.looseObject({
  kind: z.literal("value"),
  value: z.looseObject({ scope: z.string() }),
});

const TraceExecutionSchema = z.looseObject({
  kind: z.literal("execution"),
  queryText: z.string().nullable().optional(),
  rowsReturned: z.number().nullable(),
});

const TraceRawOutputSchema = z
  .looseObject({ kind: z.string(), value: z.unknown() })
  .nullable();

const JUDGE_SYSTEM_PROMPT = [
  "You grade one answer produced by Scout's Explore agent, a tool-using assistant over League of Legends match data.",
  "",
  "You are not asked whether the answer is the one you would have written. You observe four things and nothing else.",
  "",
  "1. addressed — did it answer the question, decline it, or deflect?",
  "   'deflected' means it neither answered nor said it could not: a clarifying question in response to a concrete request deflects.",
  "",
  "2. grounded — could the evidence shown have produced the figures at all?",
  "   Evidence is the queries it ran AND what its feature tools returned. A figure a feature tool returned is grounded exactly as one a query returned.",
  "   You are shown how many rows each query returned, not the rows, and a truncated excerpt of each tool result.",
  "   So do not mark an answer unsupported merely because you cannot check a specific name or number against data you cannot see — that is a limit of this evidence, not a fault in the answer.",
  "   Only FINDINGS count: figures the answer reports as true about the data. These are not findings, and never make an answer unsupported:",
  "     - a number the user wrote in the question and the answer repeats (listed below as FIGURES THE QUESTION CONTAINS);",
  "     - a parameter the answer proposes for something it is drafting or offering to run — a deadline, a stake, a game floor, a time window;",
  "     - an example inside a clarifying question or an offer, such as 'did you mean 10 PM to 5 AM?';",
  "     - the period the answer says it covered;",
  "     - a fact about how Scout's own features work, listed below as SCOUT PRODUCT FACTS. Explore is told these; repeating one needs no query.",
  "   A query that returned zero rows is evidence that nothing matched it, in its scope. It supports 'none of your server's games matched' when that is what the query asked, and nothing broader: a zero-row query with a HAVING threshold or a narrow filter does not show the data has none at all.",
  "   'unsupported' when the answer reports findings and there is no query and no tool output, or the findings go beyond what the queries could show, or they contradict the evidence.",
  "   'not_applicable' when the answer reports no findings.",
  "   Judge only whether the findings could have come from the evidence. Do not grade the choice of method, the grouping, or whether you would have written the query differently.",
  "",
  "3. coverageHonesty — did it claim Scout LACKS data that Scout actually holds?",
  ...(LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH.length === 0
    ? [
        "   Explore can query everything Scout's data lake holds. Saying 'Scout does not record that' about data a query could have read is 'overclaimed_absence'.",
      ]
    : [
        "   Scout's data lake holds the following, which Explore's query language cannot currently reach:",
        ...LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH.map(
          (entry) => `     - ${entry}`,
        ),
        "   Saying 'I cannot query that from here' about these is HONEST.",
        "   Saying 'Scout does not record that' about these is 'overclaimed_absence' — it is false about Scout.",
      ]),
  "   'not_applicable' when the answer makes no claim about what Scout holds.",
  "",
  "4. refusalKind — if a feature is switched off for this guild, was the gating the stated reason?",
  "   'wrong_reason' when it refused a gated feature by blaming missing data instead.",
  "   'not_applicable' when nothing relevant was gated off, or it did not refuse.",
  "",
  "SCOUT PRODUCT FACTS — true without any query:",
  ...[...hallOfFameFacts(), ...challengeFacts()].map((fact) => `  - ${fact}`),
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
 * Whether the turn crashed rather than answering.
 *
 * Both halves matter. An error with an answer beside it is a tool that failed
 * mid-turn, which the agent recovered from and which the answer should own up
 * to — that is behaviour, and it gets graded. An error with no answer is the
 * run falling over, and there is nothing to grade.
 */
export function crashReason(record: {
  readonly candidate: { readonly answer: string | null };
  readonly error?: unknown;
}): string | null {
  if (record.candidate.answer !== null) return null;
  if (record.error === undefined || record.error === null) return null;
  const described = describeThrown(record.error);
  return described === "" ? "the turn produced no answer" : described;
}

/**
 * The case, rendered for the judge.
 *
 * The figures are extracted here rather than left for the judge to spot,
 * because `numericClaims` already does it deterministically and a model
 * counting numbers is a model that will miscount one.
 *
 * The question's own figures are listed separately so "the answer only
 * repeated the user's number" is something the judge reads, not something it
 * has to notice. Without it, "a competition for most kills across 10 games"
 * came back unsupported for restating the 10.
 */
export function judgeUserPrompt(input: JudgeCaseInput): string {
  const gatedOff = Object.entries(input.capabilities)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name);
  const questionFigures = numericClaims(input.question);
  const figures = [...numericClaims(input.answer)];
  const echoed = figures.filter((figure) => questionFigures.has(figure));
  const queries =
    input.queries.length === 0
      ? ["(the turn ran no query)"]
      : input.queries.map(
          (query, index) =>
            `  ${(index + 1).toString()}. [${query.scope ?? "scope not recorded"}] returned ${query.rowsReturned === null ? "an unrecorded number of" : query.rowsReturned.toString()} rows: ${query.queryText ?? "(query text not recorded)"}`,
        );
  const toolResults =
    input.toolResults.length === 0
      ? ["(no feature tools returned data)"]
      : input.toolResults.map(
          (result) => `  ${result.toolName}: ${result.summary}`,
        );
  return [
    `QUESTION: ${input.question}`,
    "",
    `FEATURES OFF FOR THIS GUILD: ${gatedOff.length === 0 ? "(none)" : gatedOff.join(", ")}`,
    `THIS CHIP WAS EXPECTED TO BE: ${input.expectation ?? "(no expectation — a conversation turn)"}`,
    "",
    "QUERIES THE AGENT RAN:",
    ...queries,
    "",
    "WHAT ITS FEATURE TOOLS RETURNED:",
    ...toolResults,
    "",
    `TOOLS CALLED: ${input.toolNames.length === 0 ? "(none)" : input.toolNames.join(", ")}`,
    `FIGURES THE ANSWER ASSERTS: ${figures.length === 0 ? "(none)" : figures.join(", ")}`,
    `FIGURES THE QUESTION CONTAINS: ${questionFigures.size === 0 ? "(none)" : [...questionFigures].join(", ")}`,
    `ANSWER FIGURES ALSO IN THE QUESTION: ${echoed.length === 0 ? "(none)" : echoed.join(", ")}`,
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
     * Cases the judge could not read, with why.
     *
     * Named rather than dropped: a score over an unstated subset of the bundle
     * would look like a score over the bundle.
     */
    unjudged: z.array(
      z.object({ caseId: z.string().min(1), reason: z.string() }),
    ),
    /**
     * Cases whose turn crashed, so there is no answer to grade.
     *
     * Separate from `unjudged` because the cause is the opposite end: the
     * judge works fine, the run did not. Kept out of the score because a
     * crash is not a way of answering — graded, the one on prod scored as
     * `deflected`, which reads as a behaviour the model chose.
     *
     * The replay summary already counts these as integrity failures; naming
     * them here says which of the bundle's cases the quality number omits.
     */
    crashed: z.array(
      z.object({ caseId: z.string().min(1), reason: z.string() }),
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
