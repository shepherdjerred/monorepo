import {
  type ChampionId,
  ChampionIdSchema,
} from "#src/model/core/identifiers.ts";
import { getChampionByKey } from "#src/model/riot/champion-registry.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import type { UnitEnvironment } from "#src/tips/check-draft.ts";
import { type JudgedSet, judgeUnit } from "#src/tips/eval/judge.ts";
import {
  type EvalCaseResult,
  type EvalCases,
  type EvalReport,
  type IssueRow,
  type JudgeVerdictRow,
  type ReportSet,
  type ReportTip,
  buildReport,
} from "#src/tips/eval/report.ts";
import {
  type UnitOutcome,
  generateGeneralUnit,
  generateMatchupUnit,
} from "#src/tips/generate-unit.ts";
import {
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import {
  type TipModel,
  type TipUsage,
  EMPTY_USAGE,
  addUsage,
} from "#src/tips/model.ts";
import { mapPool } from "#src/tips/pool.ts";
import { GeneralDraftSchema, MatchupDraftSchema } from "#src/tips/prompt.ts";
import type { GlossaryEntry, GlossaryId, Tip } from "#src/tips/schema.ts";
import type { TipIssue } from "#src/tips/validate.ts";
import {
  type WikiClient,
  lookupWikiPage,
  prefetchChampionWiki,
} from "#src/tips/wiki.ts";

/**
 * The tip eval: a fixed list of pairs and single champions, run through the
 * generator without touching the generated tips, scored by the validators and
 * by two judge models from different families. Its reports are committed so a
 * change to the prompt or the model shows up as a diff, and carry the full text
 * of every set so a human can read it.
 */

function describeCite(cite: Tip["cites"][number]): string {
  switch (cite.kind) {
    case "ability": {
      return `ability ${cite.champion.toString()} ${cite.slot} ${cite.name}`;
    }
    case "abilityNumber": {
      return `number ${cite.champion.toString()} ${cite.slot} ${cite.field} ${cite.values.join("/")}`;
    }
    case "item":
    case "spell":
    case "rune": {
      return `${cite.kind} ${cite.name}`;
    }
    case "keyword": {
      return `keyword ${cite.id}`;
    }
  }
}

function reportTips(
  tips: readonly Tip[],
  bases: readonly (readonly string[])[],
  verdicts: readonly (readonly JudgeVerdictRow[])[] = [],
): ReportTip[] {
  return tips.map((tip, index) => ({
    text: tip.text,
    cites: tip.cites.map((cite) => describeCite(cite)),
    sources: [...(bases[index] ?? [])],
    verdicts: [...(verdicts[index] ?? [])],
  }));
}

/** A rejected answer's tips, as the model wrote them. */
function draftTips(
  drafts: readonly {
    text: string;
    cites: readonly object[];
    basis: readonly string[];
  }[],
): ReportTip[] {
  return drafts.map((tip) => ({
    text: tip.text,
    cites: tip.cites.map((cite) => JSON.stringify(cite)),
    sources: [...tip.basis],
    verdicts: [],
  }));
}

function issueRows(issues: readonly TipIssue[]): IssueRow[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ...(issue.tip === undefined ? {} : { tip: issue.tip }),
  }));
}

function glossaryRows(
  entries: readonly GlossaryEntry[],
): EvalCaseResult["glossaryAdditions"] {
  return entries.map((entry) => ({
    id: entry.id,
    term: entry.term,
    aliases: entry.aliases,
    definition: entry.definition,
  }));
}

function statusOf(outcome: UnitOutcome<unknown>): EvalCaseResult["status"] {
  if (outcome.status === "dropped") {
    return "dropped";
  }
  return outcome.firstAttemptIssues.length === 0
    ? "passed-first-attempt"
    : "passed-after-retry";
}

function resolveKey(key: string): ChampionId {
  const entry = getChampionByKey(key);
  if (entry === undefined) {
    throw new Error(`eval case names unknown champion key ${key}`);
  }
  return ChampionIdSchema.parse(entry.id);
}

/** The last answer's tips of a dropped case, for a human to read. */
function lastDraft(outcome: UnitOutcome<unknown>): unknown {
  return outcome.attempts.at(-1)?.draft;
}

export type EvalJudge = { model: TipModel; maxOutputTokens: number };

/** What the judges need, shared by every case of a run. */
type JudgeContext = {
  judges: readonly [EvalJudge, EvalJudge];
  wiki?: WikiClient | undefined;
  /** Judge cost by judge model, accumulated over the run. */
  costs: Record<string, number>;
};

type EvalCase =
  | { kind: "matchup"; lane: Lane; champion: string; opponent: string }
  | { kind: "general"; lane: Lane; champion: string };

type CaseRun = { result: EvalCaseResult; usage: TipUsage };

type JudgedResult = {
  /** Verdict rows per set per tip. */
  verdicts: JudgeVerdictRow[][][];
  usage: TipUsage;
  toolCalls: number;
};

/** Both judges score every tip of a unit's accepted sets, each with the wiki. */
async function judgeSets(
  context: JudgeContext,
  lane: Lane,
  sets: readonly JudgedSet[],
): Promise<JudgedResult> {
  const wiki = context.wiki;
  const names = [
    ...new Set(
      sets.flatMap((set) => [
        set.subject.name,
        ...(set.opponent === undefined ? [] : [set.opponent.name]),
      ]),
    ),
  ];
  const prefetched =
    wiki === undefined ? undefined : await prefetchChampionWiki(wiki, names);
  const notes = new Map(
    names.flatMap((name, index) => {
      const text = prefetched?.notes[index];
      return text === undefined ? [] : [[name, text] as const];
    }),
  );
  const judged = await Promise.all(
    context.judges.map(async (judge) => {
      const unit = await judgeUnit(
        judge.model,
        {
          lane,
          sets,
          notes,
          lookup:
            wiki === undefined
              ? undefined
              : (title) => lookupWikiPage(wiki, title),
        },
        judge.maxOutputTokens,
      );
      context.costs[judge.model.name] =
        (context.costs[judge.model.name] ?? 0) + unit.usage.costUsd;
      return { judge: judge.model.name, unit };
    }),
  );
  return {
    verdicts: sets.map((set, setIndex) =>
      set.tips.map((_text, tipIndex) =>
        judged.flatMap(({ judge, unit }) => {
          const verdict = unit.verdicts[setIndex]?.[tipIndex];
          return verdict === undefined ? [] : [{ ...verdict, judge }];
        }),
      ),
    ),
    usage: judged.reduce(
      (sum, entry) => addUsage(sum, entry.unit.usage),
      EMPTY_USAGE,
    ),
    toolCalls: judged.reduce((sum, entry) => sum + entry.unit.toolCalls, 0),
  };
}

const NOT_JUDGED: JudgedResult = {
  verdicts: [],
  usage: EMPTY_USAGE,
  toolCalls: 0,
};

async function runGeneralCase(
  env: UnitEnvironment,
  context: JudgeContext,
  testCase: { lane: Lane; champion: string },
): Promise<CaseRun> {
  const grounding = await loadChampionGrounding(resolveKey(testCase.champion));
  const outcome = await generateGeneralUnit(env, {
    lane: testCase.lane,
    grounding,
  });
  const rejected = GeneralDraftSchema.safeParse(lastDraft(outcome));
  const judged =
    outcome.status === "ok"
      ? await judgeSets(context, testCase.lane, [
          {
            subject: grounding,
            tips: outcome.result.set.tips.map((tip) => tip.text),
          },
        ])
      : NOT_JUDGED;
  const tips =
    outcome.status === "ok"
      ? reportTips(
          outcome.result.set.tips,
          outcome.result.basis,
          judged.verdicts[0],
        )
      : draftTips(rejected.success ? rejected.data.tips : []);
  return {
    usage: outcome.usage,
    result: {
      kind: "general",
      lane: testCase.lane,
      champions: [grounding.name],
      status: statusOf(outcome),
      calls: outcome.attempts.length,
      costUsd: outcome.usage.costUsd,
      toolCalls: outcome.toolCalls,
      wikiPages: Object.keys(outcome.wiki).length,
      judgeCostUsd: judged.usage.costUsd,
      judgeToolCalls: judged.toolCalls,
      firstAttemptIssues: issueRows(outcome.firstAttemptIssues),
      finalIssues:
        outcome.status === "dropped" ? issueRows(outcome.issues) : [],
      sets: [{ champion: grounding.name, tips }],
      glossaryAdditions:
        outcome.status === "ok"
          ? glossaryRows(outcome.result.glossaryAdditions)
          : [],
    },
  };
}

async function runMatchupCase(
  env: UnitEnvironment,
  context: JudgeContext,
  testCase: { lane: Lane; champion: string; opponent: string },
): Promise<CaseRun> {
  const [firstId, secondId] = [
    resolveKey(testCase.champion),
    resolveKey(testCase.opponent),
  ].toSorted((left, right) => left - right);
  if (firstId === undefined || secondId === undefined) {
    throw new Error("a matchup case needs two champions");
  }
  const [first, second] = await Promise.all([
    loadChampionGrounding(firstId),
    loadChampionGrounding(secondId),
  ]);
  const outcome = await generateMatchupUnit(env, {
    lane: testCase.lane,
    championIds: [firstId, secondId],
    groundings: [first, second],
  });
  const rejected = MatchupDraftSchema.safeParse(lastDraft(outcome));
  const judged =
    outcome.status === "ok"
      ? await judgeSets(context, testCase.lane, [
          {
            subject: first,
            opponent: second,
            tips: outcome.result.forward.tips.map((tip) => tip.text),
          },
          {
            subject: second,
            opponent: first,
            tips: outcome.result.reverse.tips.map((tip) => tip.text),
          },
        ])
      : NOT_JUDGED;
  const sets: ReportSet[] =
    outcome.status === "ok"
      ? [
          {
            champion: first.name,
            opponent: second.name,
            tips: reportTips(
              outcome.result.forward.tips,
              outcome.result.basis.forward,
              judged.verdicts[0],
            ),
          },
          {
            champion: second.name,
            opponent: first.name,
            tips: reportTips(
              outcome.result.reverse.tips,
              outcome.result.basis.reverse,
              judged.verdicts[1],
            ),
          },
        ]
      : [
          {
            champion: first.name,
            opponent: second.name,
            tips: draftTips(rejected.success ? rejected.data.forward : []),
          },
          {
            champion: second.name,
            opponent: first.name,
            tips: draftTips(rejected.success ? rejected.data.reverse : []),
          },
        ];
  return {
    usage: outcome.usage,
    result: {
      kind: "matchup",
      lane: testCase.lane,
      champions: [first.name, second.name],
      status: statusOf(outcome),
      calls: outcome.attempts.length,
      costUsd: outcome.usage.costUsd,
      toolCalls: outcome.toolCalls,
      wikiPages: Object.keys(outcome.wiki).length,
      judgeCostUsd: judged.usage.costUsd,
      judgeToolCalls: judged.toolCalls,
      firstAttemptIssues: issueRows(outcome.firstAttemptIssues),
      finalIssues:
        outcome.status === "dropped" ? issueRows(outcome.issues) : [],
      sets,
      glossaryAdditions:
        outcome.status === "ok"
          ? glossaryRows(outcome.result.glossaryAdditions)
          : [],
    },
  };
}

function runEvalCase(
  env: UnitEnvironment,
  context: JudgeContext,
  testCase: EvalCase,
): Promise<CaseRun> {
  return testCase.kind === "general"
    ? runGeneralCase(env, context, testCase)
    : runMatchupCase(env, context, testCase);
}

export type EvalOptions = {
  model: TipModel;
  judges: readonly [EvalJudge, EvalJudge];
  /** The League of Legends Wiki for the generator and the judges; absent runs on the grounding alone. */
  wiki?: WikiClient | undefined;
  promptVersion: string;
  /** Which run of this model this is, for the report's name and spread. */
  run: number;
  cases: EvalCases;
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>;
  maxOutputTokens: number;
  concurrency: number;
  now: Date;
  log?: ((line: string) => void) | undefined;
};

export async function runEval(options: EvalOptions): Promise<EvalReport> {
  const env: UnitEnvironment = {
    model: options.model,
    promptVersion: options.promptVersion,
    abilityIndex: await loadAbilityNameIndex(),
    glossary: options.glossary,
    maxOutputTokens: options.maxOutputTokens,
    wiki: options.wiki,
  };
  const context: JudgeContext = {
    judges: options.judges,
    wiki: options.wiki,
    costs: {},
  };
  const cases: EvalCase[] = [
    ...options.cases.matchups.map((entry): EvalCase => ({
      kind: "matchup",
      ...entry,
    })),
    ...options.cases.general.map((entry): EvalCase => ({
      kind: "general",
      ...entry,
    })),
  ];
  const runs = await mapPool(cases, options.concurrency, async (testCase) => {
    const run = await runEvalCase(env, context, testCase);
    options.log?.(
      `${run.result.status.padEnd(20)} ${run.result.lane} ${run.result.champions.join(" vs ")}`,
    );
    return run;
  });
  return buildReport(
    {
      model: options.model.name,
      run: options.run,
      promptVersion: options.promptVersion,
      judgeModels: [options.judges[0].model.name, options.judges[1].model.name],
      judgeCostUsd: context.costs,
      now: options.now,
    },
    runs.map((run) => run.result),
    runs.reduce((sum, run) => addUsage(sum, run.usage), EMPTY_USAGE),
  );
}
