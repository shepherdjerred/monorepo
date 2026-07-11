import { z } from "zod";
import { LeetCodeClient } from "./lib/leetcode-graphql.ts";
import { formatDuration, timestamp } from "./lib/format.ts";

const BATCH_SIZE = 100;
const OUTPUT_PATH = new URL("../data/problems-list.json", import.meta.url)
  .pathname;

const LIST_QUERY = `
query problemsetQuestionListV2($categorySlug: String!, $limit: Int, $skip: Int, $filters: QuestionFilterInput!) {
  problemsetQuestionListV2(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    totalLength
    hasMore
    questions {
      titleSlug
      title
      questionFrontendId
      difficulty
      paidOnly
      topicTags { name slug }
      acRate
      frequency
    }
  }
}`;

const QuestionSchema = z.object({
  titleSlug: z.string(),
  title: z.string(),
  questionFrontendId: z.string(),
  difficulty: z.string(),
  paidOnly: z.boolean(),
  topicTags: z.array(z.object({ name: z.string(), slug: z.string() })),
  acRate: z.number(),
  frequency: z.number().nullable(),
});

const ProblemListResponseSchema = z.object({
  problemsetQuestionListV2: z.object({
    totalLength: z.number(),
    hasMore: z.boolean(),
    questions: z.array(QuestionSchema),
  }),
});

type Question = z.infer<typeof QuestionSchema>;

async function main() {
  const client = new LeetCodeClient(2000, 4000);
  const allQuestions: Question[] = [];
  const startTime = Date.now();

  console.log(`[${timestamp()}] Starting problem list scrape...`);

  let skip = 0;
  let batch = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await client.query(LIST_QUERY, {
      categorySlug: "",
      limit: BATCH_SIZE,
      skip,
      filters: { filterCombineType: "ALL" },
    });

    if (result.errors) {
      console.error(`[${timestamp()}] GraphQL errors:`, result.errors);
      process.exit(1);
    }

    const parsed = ProblemListResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      console.error(`[${timestamp()}] GraphQL returned no data`);
      process.exit(1);
    }
    const list = parsed.data.problemsetQuestionListV2;
    allQuestions.push(...list.questions);

    console.log(
      `[${timestamp()}] Batch ${String(batch)} — got ${String(list.questions.length)} problems (${String(allQuestions.length)}/${String(list.totalLength)}) — ${formatDuration(Date.now() - startTime)} elapsed`,
    );

    hasMore = list.hasMore;
    skip += BATCH_SIZE;
    batch++;
  }

  await Bun.write(OUTPUT_PATH, JSON.stringify(allQuestions, null, 2));
  console.log(
    `\n[${timestamp()}] Done! Wrote ${String(allQuestions.length)} problems to ${OUTPUT_PATH} in ${formatDuration(Date.now() - startTime)}`,
  );
}

try {
  await main();
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n[FATAL] ${msg}`);
  process.exit(1);
}
