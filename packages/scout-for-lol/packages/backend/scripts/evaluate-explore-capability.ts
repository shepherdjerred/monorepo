import { Output, generateText, stepCountIs } from "ai";
import {
  ExploreAnswerWireSchema,
  ExploreCapabilityCorpusSchema,
  type ExploreCapabilityCase,
  type ExploreCapabilityCorpus,
} from "@scout-for-lol/data";
import {
  createLlmRuntime,
  providerCredentialsFromEnv,
  requireCredentialsFor,
} from "@shepherdjerred/llm-runtime";
import {
  capabilityAnswerIssues,
  EXPLORE_CAPABILITY_EVAL_MODEL,
  ExploreCapabilityEvalReportSchema,
  exploreCapabilityEvalSha256,
} from "#src/explore/capability-eval.ts";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import {
  enabledExploreSkills,
  type ExploreSkillOptions,
} from "#src/explore/skills/registry.ts";
import { createLoadSkillTool } from "#src/explore/skills/tool.ts";
import { emitEvalReport } from "#src/explore/eval-report-output.ts";

/**
 * Does Explore say "Scout does not do that" when Scout does not do that?
 *
 * Runs the REAL system prompt against first-turn questions, with the real
 * `load_skill` tool and nothing else. That shape is deliberate on both sides.
 *
 * `load_skill` is present because the production failure was a model that
 * never opened the creation skill: leaving it out would hand the answer over
 * and stop measuring the decision that actually went wrong. The query tools
 * are absent because every question here is answerable from instructions
 * alone — if a case needs a query to answer honestly, it does not belong in
 * this corpus.
 *
 * The absence used to cost correctness rather than coverage: with no tools at
 * all the model would sometimes emit a half-formed `load_skill` call instead
 * of its structured answer, and the turn failed to parse — an artifact of the
 * harness scored as a behavioural failure. Giving it the real tool removed
 * that.
 *
 * Like the dare eval, this calls a live model and is therefore a manual gate,
 * not a CI one. Run it after touching `prompt.ts` or `skills/content/*.md`.
 */

const CORPUS_URL = new URL(
  "../../data/src/model/reports/explore-capability-corpus.json",
  import.meta.url,
);
/** Bounded so a model that will not answer still fails the case. */
const MAX_ANSWER_ATTEMPTS = 3;

const REPORT_URL = new URL(
  "../src/explore/explore-capability-eval-report.json",
  import.meta.url,
);

function skillOptionsFor(entry: ExploreCapabilityCase): ExploreSkillOptions {
  return { bucks: null, creation: entry.creationEnabled, surface: "web" };
}

function instructionsFor(entry: ExploreCapabilityCase): string {
  return exploreAgentInstructions(skillOptionsFor(entry));
}

/** The same skill loader the agent gets, over this turn's enabled skills. */
function loadSkillToolFor(entry: ExploreCapabilityCase) {
  return createLoadSkillTool({
    skills: enabledExploreSkills(skillOptionsFor(entry)),
    context: { bucks: null, surface: "web" },
    track: async (_toolName, work) => await work(),
    onLoaded: () => undefined,
  });
}

async function loadCorpus(): Promise<{
  corpus: ExploreCapabilityCorpus;
  raw: string;
}> {
  const raw = await Bun.file(CORPUS_URL).text();
  const parsed: unknown = JSON.parse(raw);
  return { corpus: ExploreCapabilityCorpusSchema.parse(parsed), raw };
}

/** The AI SDK's wording when a turn produced no parsable structured object. */
function isMissingOutput(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("No output generated") ||
    message.includes("No object generated")
  );
}

async function answerOnce(
  runtime: ReturnType<typeof createLlmRuntime>,
  entry: ExploreCapabilityCase,
): Promise<string> {
  const result = await generateText({
    model: runtime.languageModel(EXPLORE_CAPABILITY_EVAL_MODEL),
    system: instructionsFor(entry),
    prompt: entry.question,
    tools: { load_skill: loadSkillToolFor(entry) },
    // One step to load a skill, one to answer with it, and slack for a model
    // that loads two.
    stopWhen: stepCountIs(4),
    output: Output.object({ schema: ExploreAnswerWireSchema }),
    ...runtime.callOptions({ workload: "scout.explore.capability-eval" }),
  });
  return result.output.answer;
}

async function evaluateCase(
  runtime: ReturnType<typeof createLlmRuntime>,
  entry: ExploreCapabilityCase,
): Promise<{
  id: string;
  question: string;
  creationEnabled: boolean;
  attempts: number;
  passed: boolean;
  answer: string | null;
  issues: string[];
}> {
  let attempts = 0;
  try {
    let answer: string | null = null;
    // A turn that ends on a tool call decodes to no structured object. That is
    // the harness reading nothing, not the model answering badly, so it is
    // retried — but only for that condition, and only to this bound, so a
    // model that genuinely will not answer still fails. `attempts` is reported
    // either way: a case that needs retries to pass is a case to look at.
    while (attempts < MAX_ANSWER_ATTEMPTS) {
      attempts++;
      try {
        answer = await answerOnce(runtime, entry);
        break;
      } catch (error) {
        if (!isMissingOutput(error) || attempts >= MAX_ANSWER_ATTEMPTS)
          throw error;
      }
    }
    if (answer === null) throw new Error("No answer after retries.");
    const issues = [...capabilityAnswerIssues({ answer, entry })];
    return {
      id: entry.id,
      question: entry.question,
      creationEnabled: entry.creationEnabled,
      attempts,
      passed: issues.length === 0,
      answer,
      issues,
    };
  } catch (error) {
    return {
      id: entry.id,
      question: entry.question,
      creationEnabled: entry.creationEnabled,
      attempts,
      passed: false,
      answer: null,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function main(): Promise<void> {
  requireCredentialsFor(EXPLORE_CAPABILITY_EVAL_MODEL);
  const { corpus, raw } = await loadCorpus();
  const runtime = createLlmRuntime({
    credentials: providerCredentialsFromEnv(),
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
  await emitEvalReport(report, REPORT_URL);
}

await main();
