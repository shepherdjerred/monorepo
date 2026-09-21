import path from "node:path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { Output, generateText } from "ai";
import { createOpenRouterRuntime } from "@shepherdjerred/llm-runtime";
import {
  ReplayCaseCandidateSchema,
  ReplayManifestSchema,
  replayBundleRoot,
} from "#src/explore/replay/bundle.ts";
import {
  EXPLORE_JUDGE_MODEL,
  ExploreJudgeReportSchema,
  JudgeObservationSchema,
  gradeCase,
  judgePromptSha256,
  judgeSystemPrompt,
  judgeUserPrompt,
  scoreBundle,
  type JudgeObservation,
  type JudgedCase,
} from "#src/explore/replay/judge.ts";
import { emitEvalReport } from "#src/explore/eval-report-output.ts";

/**
 * Score a replay bundle on answer quality.
 *
 * Offline: it reads a bundle the replay already produced and never runs the
 * Explore agent. That is what makes a rubric change cheap — re-judging a
 * stored sweep costs one judge pass, not 233 agent turns against a live lake.
 *
 * The grading itself lives in `#src/explore/replay/judge.ts` so tests pin it.
 * This file only fetches observations and writes the report.
 */

const USAGE = `Usage: bun run explore:judge -- <bundleDir> [options]

Grades a replay bundle's answers and writes a quality report.

Options:
  --concurrency <n>   Cases judged at once (default: 6)
  --write             Persist the report beside the bundle
  --help              Show this help

This calls a live model and is a manual gate, never CI.`;

const CaseFileSchema = z
  .looseObject({
    meta: z.looseObject({
      caseId: z.string().min(1),
      condition: z.string().nullable(),
      expectation: z.enum(["answerable", "gated-off", "either"]).nullable(),
      capabilities: z.record(z.string(), z.boolean()),
    }),
    prompt: z.array(z.looseObject({ role: z.string(), content: z.string() })),
    candidate: ReplayCaseCandidateSchema,
  })
  .loose();

type CaseFile = z.infer<typeof CaseFileSchema>;

/** The user's question, which is the last thing they said. */
function questionFrom(record: CaseFile): string {
  const asked = record.prompt.filter((entry) => entry.role === "user");
  return asked.at(-1)?.content ?? "(no question recorded)";
}

async function observe(
  runtime: ReturnType<typeof createOpenRouterRuntime>,
  record: CaseFile,
): Promise<JudgeObservation> {
  const result = await generateText({
    model: runtime.languageModel(EXPLORE_JUDGE_MODEL),
    system: judgeSystemPrompt(),
    prompt: judgeUserPrompt({
      question: questionFrom(record),
      answer: record.candidate.answer,
      queryText: record.candidate.queryText,
      rowsReturned: record.candidate.rowsReturned,
      toolNames: record.candidate.toolNames,
      expectation: record.meta.expectation,
      capabilities: record.meta.capabilities,
    }),
    output: Output.object({ schema: JudgeObservationSchema }),
    ...runtime.callOptions({ workload: "scout.explore.replay-judge" }),
  });
  return result.output;
}

/**
 * Judge with bounded concurrency, preserving bundle order.
 *
 * Order is kept for the same reason the runner keeps it: a report whose case
 * order depended on which judge call returned first could not be diffed
 * against another report of the same bundle.
 */
async function observeAll(
  runtime: ReturnType<typeof createOpenRouterRuntime>,
  records: readonly CaseFile[],
  concurrency: number,
): Promise<readonly JudgedCase[]> {
  const results: (JudgedCase | undefined)[] = Array.from({
    length: records.length,
  });
  let next = 0;
  let judged = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      const record = records[index];
      if (record === undefined) return;
      const observation = await observe(runtime, record);
      results[index] = {
        caseId: record.meta.caseId,
        condition: record.meta.condition,
        expectation: record.meta.expectation,
        observation,
        grade: gradeCase({
          observation,
          expectation: record.meta.expectation,
        }),
      };
      judged += 1;
      if (judged % 25 === 0) {
        process.stderr.write(
          `  judged ${judged.toString()}/${records.length.toString()}\n`,
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, records.length)) },
      () => worker(),
    ),
  );

  return results.map((entry, index) => {
    if (entry === undefined) {
      throw new Error(`Case at index ${index.toString()} was never judged.`);
    }
    return entry;
  });
}

function parseArgs(args: readonly string[]): {
  readonly bundleDir: string;
  readonly concurrency: number;
} {
  const positional = args.filter((entry) => !entry.startsWith("--"));
  const bundleDir = positional[0];
  if (bundleDir === undefined) {
    throw new Error("A bundle directory is required.");
  }
  const flag = args.indexOf("--concurrency");
  const raw = flag === -1 ? "6" : (args[flag + 1] ?? "6");
  const concurrency = Number(raw);
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`--concurrency must be a positive integer, got ${raw}`);
  }
  // A path given relative to the bundle root is the shape a runId has.
  const resolved = bundleDir.includes(path.sep)
    ? path.resolve(process.cwd(), bundleDir)
    : path.join(replayBundleRoot(Bun.env), bundleDir);
  return { bundleDir: resolved, concurrency };
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const apiKey = Bun.env["OPENROUTER_API_KEY"];
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error("OPENROUTER_API_KEY is required to judge a bundle.");
  }
  const { bundleDir, concurrency } = parseArgs(args);

  const manifest = ReplayManifestSchema.parse(
    await Bun.file(path.join(bundleDir, "manifest.json")).json(),
  );
  const caseDir = path.join(bundleDir, "cases");
  const files = (await readdir(caseDir))
    .filter((name) => name.endsWith(".json"))
    .toSorted();
  const records: CaseFile[] = [];
  for (const file of files) {
    records.push(
      CaseFileSchema.parse(await Bun.file(path.join(caseDir, file)).json()),
    );
  }

  process.stderr.write(
    `judging ${records.length.toString()} cases from ${manifest.runId} with ${EXPLORE_JUDGE_MODEL}\n`,
  );
  const runtime = createOpenRouterRuntime({
    apiKey,
    service: "scout-explore-replay-judge",
    appName: "Scout Explore Replay Judge",
  });
  const judged = await observeAll(runtime, records, concurrency);
  const bundle = scoreBundle(judged);

  const report = ExploreJudgeReportSchema.parse({
    version: 1,
    bundleRunId: manifest.runId,
    stage: manifest.stage,
    profile: manifest.profile,
    judgeModel: EXPLORE_JUDGE_MODEL,
    judgePromptSha256: judgePromptSha256(),
    generatedAt: new Date().toISOString(),
    bundle,
    cases: judged.map((entry) => ({
      caseId: entry.caseId,
      condition: entry.condition,
      expectation: entry.expectation,
      score: entry.grade.score,
      failures: [...entry.grade.failures],
      observation: entry.observation,
    })),
    // The judge graded everything it was handed. The quality number is
    // `bundle.score`, and it deliberately carries no threshold.
    passed: true,
  });

  await emitEvalReport(report, new URL(`file://${bundleDir}/judge.json`));
}

await main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
