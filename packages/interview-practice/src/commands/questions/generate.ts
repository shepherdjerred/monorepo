import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "#config";
import { createLogger } from "#logger";
import { createAIClient } from "#lib/ai/client.ts";
import { LeetcodeQuestionSchema } from "#lib/questions/schemas.ts";

export type GenerateOptions = {
  title: string;
  description: string;
  difficulty?: "easy" | "medium" | "hard" | undefined;
  tags?: string[] | undefined;
  outDir?: string | undefined;
};

const GENERATE_PROMPT = `You are a coding interview question designer. Given a problem description, generate a complete multi-part interview question in JSON format.

The output must be valid JSON matching this schema:
{
  "id": "<uuid>",
  "title": "<string>",
  "slug": "<kebab-case>",
  "difficulty": "easy" | "medium" | "hard",
  "tags": ["array", "hash-map", ...],
  "description": "<full problem statement>",
  "parts": [
    {
      "partNumber": 1,
      "prompt": "<what the interviewer tells the candidate>",
      "internalNotes": "<for reflection model only>",
      "hints": [
        { "level": "subtle" | "moderate" | "explicit", "content": "<hint text>" }
      ],
      "testCases": [
        { "input": "<stdin>", "expected": "<stdout>", "explanation": "<optional>" }
      ],
      "followUps": ["<follow-up questions>"],
      "expectedApproach": "<description of expected approach>",
      "expectedComplexity": { "time": "O(...)", "space": "O(...)" },
      "transitionCriteria": {
        "minApproachQuality": "working" | "optimal" | "explained",
        "mustExplainComplexity": true | false,
        "transitionPrompt": "<framing for next part>"
      }
    }
  ],
  "constraints": ["<constraint>"],
  "io": {
    "inputFormat": "<e.g. int[] nums, int target>",
    "outputFormat": "<e.g. int[]>",
    "parseHint": "<how to parse stdin>"
  },
  "source": "generated",
  "escalationPattern": "constraint-addition" | "static-to-dynamic" | "existence-to-enumeration" | "single-to-distributed" | "concrete-to-symbolic" | "specific-to-general"
}

Requirements:
- Generate 2-3 parts with increasing difficulty
- Each part needs at least 3 test cases covering edge cases
- Include subtle, moderate, and explicit hints for each part
- Test case inputs/outputs must be valid stdin/stdout strings
- The escalation pattern should match how parts progress

Return ONLY the JSON object, no markdown fences or explanation.`;

export async function generateQuestion(
  config: Config,
  options: GenerateOptions,
): Promise<void> {
  const logger = createLogger({
    level: config.logLevel,
    sessionId: "generate",
    logFilePath: path.join(config.dataDir, "generate.log"),
    component: "cli",
  });

  const model = config.conversationModel ?? "claude-sonnet-4-6-20260217";
  const apiKeyForProvider =
    config.aiProvider === "anthropic"
      ? config.anthropicApiKey
      : config.aiProvider === "openai"
        ? config.openaiApiKey
        : config.googleApiKey;
  const client = createAIClient(config.aiProvider, model, apiKeyForProvider);

  const difficultyHint =
    options.difficulty === undefined
      ? ""
      : `\nTarget difficulty: ${options.difficulty}`;
  const tagsHint =
    options.tags !== undefined && options.tags.length > 0
      ? `\nRelevant tags: ${options.tags.join(", ")}`
      : "";

  const userPrompt = `Generate a complete interview question based on this:

Title: ${options.title}
Description: ${options.description}${difficultyHint}${tagsHint}

Use this UUID for the id: ${randomUUID()}`;

  console.log("Generating question...");

  const response = await client.chat({
    systemPrompt: GENERATE_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 8192,
  });

  logger.info("generate_response", {
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
  });

  // Parse the response
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text) as unknown;
  } catch {
    console.error("Failed to parse AI response as JSON.");
    console.error("Raw response:");
    console.error(response.text);
    process.exit(1);
  }

  const result = LeetcodeQuestionSchema.safeParse(parsed);
  if (!result.success) {
    console.error("Generated question does not match schema:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.message} (at ${issue.path.join(".")})`);
    }
    console.error("\nRaw response saved for debugging.");

    const debugPath = path.join(config.dataDir, "generate-debug.json");
    await Bun.write(debugPath, JSON.stringify(parsed, null, 2));
    console.error(`Debug output: ${debugPath}`);
    process.exit(1);
  }

  const question = result.data;
  const outDir =
    options.outDir ??
    path.join(config.dataDir, "questions", "generated");

  Bun.spawnSync(["mkdir", "-p", outDir]);

  const outPath = path.join(outDir, `${question.slug}.json`);
  await Bun.write(outPath, JSON.stringify(question, null, 2));

  console.log(`Question generated successfully!`);
  console.log(`  Title:      ${question.title}`);
  console.log(`  Slug:       ${question.slug}`);
  console.log(`  Difficulty: ${question.difficulty}`);
  console.log(`  Parts:      ${String(question.parts.length)}`);
  console.log(`  Tags:       ${question.tags.join(", ")}`);
  console.log(`  Saved to:   ${outPath}`);
}
