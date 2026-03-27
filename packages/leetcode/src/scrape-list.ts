import {
  LeetCodeClient,
  formatDuration,
  timestamp,
} from "./lib/leetcode-graphql";

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

interface ProblemListResponse {
  problemsetQuestionListV2: {
    totalLength: number;
    hasMore: boolean;
    questions: Array<{
      titleSlug: string;
      title: string;
      questionFrontendId: string;
      difficulty: string;
      paidOnly: boolean;
      topicTags: Array<{ name: string; slug: string }>;
      acRate: number;
      frequency: number | null;
    }>;
  };
}

async function main() {
  const client = new LeetCodeClient(2000, 4000);
  const allQuestions: ProblemListResponse["problemsetQuestionListV2"]["questions"] =
    [];
  const startTime = Date.now();

  console.log(`[${timestamp()}] Starting problem list scrape...`);

  let skip = 0;
  let totalLength = 0;
  let batch = 1;

  while (true) {
    const result = await client.query<ProblemListResponse>(LIST_QUERY, {
      categorySlug: "",
      limit: BATCH_SIZE,
      skip,
      filters: { filterCombineType: "ALL" },
    });

    if (result.errors) {
      console.error(`[${timestamp()}] GraphQL errors:`, result.errors);
      process.exit(1);
    }

    const list = result.data!.problemsetQuestionListV2;
    totalLength = list.totalLength;
    allQuestions.push(...list.questions);

    console.log(
      `[${timestamp()}] Batch ${batch} — got ${list.questions.length} problems (${allQuestions.length}/${totalLength}) — ${formatDuration(Date.now() - startTime)} elapsed`,
    );

    if (!list.hasMore) break;
    skip += BATCH_SIZE;
    batch++;
  }

  await Bun.write(OUTPUT_PATH, JSON.stringify(allQuestions, null, 2));
  console.log(
    `\n[${timestamp()}] Done! Wrote ${allQuestions.length} problems to ${OUTPUT_PATH} in ${formatDuration(Date.now() - startTime)}`,
  );
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
