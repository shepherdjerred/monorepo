import { Output, generateText } from "ai";
import {
  DareParaphraseCorpusSchema,
  type DareParaphraseCorpus,
} from "@scout-for-lol/data";
import { createOpenRouterRuntime } from "@shepherdjerred/llm-runtime";
import { darePlanSemanticIssues } from "#src/betting/dare-contract-compiler-v2.ts";
import { prepareDareDraftV2 } from "#src/betting/dare-draft-v2.ts";
import {
  canonicalDarePlanJsonV2,
  canonicalDarePlanV2,
} from "#src/betting/dare-plan-canonical-v2.ts";
import { renderDarePlanV2 } from "#src/betting/dare-render-v2.ts";
import { DareDefinitionToolInputSchema } from "#src/explore/dare-tools.ts";
import {
  DARE_V2_EVAL_MODEL,
  DareModelEvalReportSchema,
  dareModelEvalSha256,
  resolveDareModelEvalTargets,
} from "#src/explore/dare-model-eval-v2.ts";
import { dareExplorePromptSection } from "#src/explore/prompt.ts";

const CORPUS_URL = new URL(
  "../../data/src/model/dare-v2-paraphrase-corpus.json",
  import.meta.url,
);
const REPORT_URL = new URL(
  "../src/explore/dare-v2-model-eval-report.json",
  import.meta.url,
);
const FIXED_NOW = new Date("2026-09-01T00:00:00.000Z");

async function loadCorpus(): Promise<{
  corpus: DareParaphraseCorpus;
  raw: string;
}> {
  const raw = await Bun.file(CORPUS_URL).text();
  const parsed: unknown = JSON.parse(raw);
  return { corpus: DareParaphraseCorpusSchema.parse(parsed), raw };
}

function evalPrompt(input: {
  paraphrase: string;
  targetAliases: Readonly<Record<string, string>>;
  openingStake: number;
}): string {
  return [
    "Translate this dare request into the required structured contract.",
    `Current time: ${FIXED_NOW.toISOString()}`,
    `Available frozen targets: ${Object.entries(input.targetAliases)
      .map(([key, alias]) => `${key}=${alias}`)
      .join(", ")}`,
    `Set targetKeys to exactly: ${Object.keys(input.targetAliases).join(", ")}. Use those exact keys in every plan target reference.`,
    `Set openingStake to exactly ${input.openingStake.toString()} BB.`,
    "If the request has no deadline, set deadlineSpec to exactly 7 relative days. If it names an absolute deadline, translate that date and preserve its explicit IANA timezone.",
    "Preserve the user's exact request in originalText.",
    "Request:",
    input.paraphrase,
  ].join("\n");
}

async function evaluateParaphrase(
  runtime: ReturnType<typeof createOpenRouterRuntime>,
  entry: DareParaphraseCorpus["cases"][number],
  paraphrase: string,
) {
  try {
    const result = await generateText({
      model: runtime.languageModel(DARE_V2_EVAL_MODEL),
      system: dareExplorePromptSection(),
      prompt: evalPrompt({
        paraphrase,
        targetAliases: entry.targetAliases,
        openingStake: entry.openingStake,
      }),
      output: Output.object({ schema: DareDefinitionToolInputSchema }),
      maxOutputTokens: 8000,
      ...runtime.callOptions({ workload: "scout.dare-v2-eval" }),
    });
    const output = DareDefinitionToolInputSchema.parse(result.output);
    const resolvedTargets = resolveDareModelEvalTargets({
      targetKeys: output.targetKeys,
      targetAliases: entry.targetAliases,
    });
    const targets = resolvedTargets.targets;
    const issues = [
      ...resolvedTargets.issues,
      ...darePlanSemanticIssues(output.plan, targets),
    ];
    const prepared = prepareDareDraftV2(
      {
        originalText: output.originalText,
        plan: output.plan,
        targets,
        deadlineSpec: output.deadlineSpec,
        openingStake: output.openingStake,
      },
      FIXED_NOW,
    );
    if (prepared.kind === "invalid") issues.push(...prepared.issues);
    const actualCanonicalPlan = canonicalDarePlanV2(output.plan);
    const actualCanonicalSha256 = dareModelEvalSha256(
      canonicalDarePlanJsonV2(actualCanonicalPlan),
    );
    const actualMeaning = renderDarePlanV2(output.plan, targets);
    if (actualCanonicalSha256 !== entry.expectedCanonicalSha256) {
      issues.push("Canonical plan drifted.");
    }
    if (actualMeaning !== entry.expectedMeaning) {
      issues.push("Rendered meaning drifted.");
    }
    const metadataMatches =
      JSON.stringify(output.deadlineSpec) ===
        JSON.stringify(entry.deadlineSpec) &&
      output.openingStake === entry.openingStake;
    if (!metadataMatches) issues.push("Deadline or opening stake drifted.");
    const passed =
      issues.length === 0 &&
      actualCanonicalSha256 === entry.expectedCanonicalSha256;
    return {
      id: entry.id,
      paraphrase,
      passed,
      expectedCanonicalSha256: entry.expectedCanonicalSha256,
      actualCanonicalSha256,
      actualCanonicalPlan,
      expectedMeaning: entry.expectedMeaning,
      actualMeaning,
      issues,
    };
  } catch (error) {
    return {
      id: entry.id,
      paraphrase,
      passed: false,
      expectedCanonicalSha256: entry.expectedCanonicalSha256,
      actualCanonicalSha256: null,
      actualCanonicalPlan: null,
      expectedMeaning: entry.expectedMeaning,
      actualMeaning: null,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function main(): Promise<void> {
  const apiKey = Bun.env["OPENROUTER_API_KEY"];
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error("OPENROUTER_API_KEY is required for Dare v2 model evals.");
  }
  const { corpus, raw } = await loadCorpus();
  const runtime = createOpenRouterRuntime({
    apiKey,
    service: "scout-dare-v2-evals",
    appName: "Scout Dare v2 Evals",
  });
  const cases = [];
  for (const entry of corpus.cases) {
    for (const paraphrase of entry.paraphrases) {
      cases.push(await evaluateParaphrase(runtime, entry, paraphrase));
    }
  }
  const report = DareModelEvalReportSchema.parse({
    version: 2,
    corpusVersion: corpus.version,
    promptVersion: corpus.promptVersion,
    promptSha256: dareModelEvalSha256(dareExplorePromptSection()),
    corpusSha256: dareModelEvalSha256(raw),
    model: DARE_V2_EVAL_MODEL,
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
