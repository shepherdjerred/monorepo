import { Output, generateText } from "ai";
import {
  ExploreAnswerWireSchema,
  ExploreCapabilityCorpusSchema,
  type ExploreCapabilityCase,
  type ExploreCapabilityCorpus,
} from "@scout-for-lol/data";
import { createOpenRouterRuntime } from "@shepherdjerred/llm-runtime";
import {
  capabilityAnswerIssues,
  EXPLORE_CAPABILITY_EVAL_MODEL,
  ExploreCapabilityEvalReportSchema,
  exploreCapabilityEvalSha256,
} from "#src/explore/capability-eval.ts";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { exploreSkillBody } from "#src/explore/skills/registry.ts";

/**
 * Does Explore say "Scout does not do that" when Scout does not do that?
 *
 * Runs the REAL system prompt and the REAL creation skill against first-turn
 * questions, with no tools. No tools is the point: this measures what the
 * instruction text alone makes the model say, which is exactly what failed in
 * production — the tools were present and unused because the prompt had
 * already told the model the subject was closed.
 *
 * Like the dare eval, this calls a live model and is therefore a manual gate,
 * not a CI one. Run it after touching `prompt.ts` or `skills/content/*.md`.
 */

const CORPUS_URL = new URL(
  "../../data/src/model/reports/explore-capability-corpus.json",
  import.meta.url,
);
const REPORT_URL = new URL(
  "../src/explore/explore-capability-eval-report.json",
  import.meta.url,
);

/**
 * The skill index tells the model a skill exists; `load_skill` returns its
 * body. With tools off, the body is appended directly so the case measures
 * the skill text rather than the model's willingness to call a tool.
 */
function instructionsFor(entry: ExploreCapabilityCase): string {
  const base = exploreAgentInstructions({
    bucks: null,
    creation: entry.creationEnabled,
    surface: "web",
  });
  return entry.creationEnabled
    ? `${base}\n\n<<loaded skill: creation>>\n${exploreSkillBody("creation")}`
    : base;
}

async function loadCorpus(): Promise<{
  corpus: ExploreCapabilityCorpus;
  raw: string;
}> {
  const raw = await Bun.file(CORPUS_URL).text();
  const parsed: unknown = JSON.parse(raw);
  return { corpus: ExploreCapabilityCorpusSchema.parse(parsed), raw };
}

async function evaluateCase(
  runtime: ReturnType<typeof createOpenRouterRuntime>,
  entry: ExploreCapabilityCase,
): Promise<{
  id: string;
  question: string;
  creationEnabled: boolean;
  passed: boolean;
  answer: string | null;
  issues: string[];
}> {
  try {
    const result = await generateText({
      model: runtime.languageModel(EXPLORE_CAPABILITY_EVAL_MODEL),
      system: instructionsFor(entry),
      prompt: entry.question,
      output: Output.object({ schema: ExploreAnswerWireSchema }),
      ...runtime.callOptions({ workload: "scout.explore.capability-eval" }),
    });
    const answer = result.output.answer;
    const issues = [...capabilityAnswerIssues({ answer, entry })];
    return {
      id: entry.id,
      question: entry.question,
      creationEnabled: entry.creationEnabled,
      passed: issues.length === 0,
      answer,
      issues,
    };
  } catch (error) {
    return {
      id: entry.id,
      question: entry.question,
      creationEnabled: entry.creationEnabled,
      passed: false,
      answer: null,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function main(): Promise<void> {
  const apiKey = Bun.env["OPENROUTER_API_KEY"];
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      "OPENROUTER_API_KEY is required for Explore capability evals.",
    );
  }
  const { corpus, raw } = await loadCorpus();
  const runtime = createOpenRouterRuntime({
    apiKey,
    service: "scout-explore-capability-evals",
    appName: "Scout Explore Capability Evals",
  });
  const cases = [];
  for (const entry of corpus.cases) {
    cases.push(await evaluateCase(runtime, entry));
  }
  const report = ExploreCapabilityEvalReportSchema.parse({
    version: 1,
    corpusVersion: corpus.version,
    corpusSha256: exploreCapabilityEvalSha256(raw),
    promptSha256: exploreCapabilityEvalSha256(
      corpus.cases.map((entry) => instructionsFor(entry)).join("\n---\n"),
    ),
    model: EXPLORE_CAPABILITY_EVAL_MODEL,
    generatedAt: new Date().toISOString(),
    passed: cases.every((entry) => entry.passed),
    cases,
  });
  if (Bun.argv.includes("--write")) {
    await Bun.write(REPORT_URL, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
