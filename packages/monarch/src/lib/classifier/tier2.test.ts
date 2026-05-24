import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { CategoryDefinition } from "../knowledge/types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import { classifyTier2, type Tier2Classifier } from "./tier2.ts";
import { loadTier2Checkpoint } from "./tier2-checkpoint.ts";

const definitions: CategoryDefinition[] = [
  {
    id: "cat-shopping",
    name: "Shopping",
    group: "Expenses",
    description: "General purchases",
    examples: [],
    notThisCategory: [],
  },
  {
    id: "cat-software",
    name: "Software",
    group: "Expenses",
    description: "Software and SaaS",
    examples: ["OpenAI"],
    notThisCategory: [],
  },
];

describe("classifyTier2 checkpoint recovery", () => {
  test("writes checkpoint entries and reuses them on the next run", async () => {
    const dir = await makeTempDir();
    const checkpointPath = path.join(dir, "tier2.checkpoint.json");
    try {
      const transactions = [
        enrichedTransaction("txn-1", "OpenAI"),
        enrichedTransaction("txn-2", "PagerDuty"),
      ];
      let calls = 0;
      const classifier: Tier2Classifier = async () => {
        const transactionIndex = 0;
        calls++;
        return {
          result: {
            transactions: [
              {
                transactionIndex,
                categoryId: "cat-software",
                categoryName: "Software",
                confidence: "high",
                shouldSplit: false,
                splits: [],
              },
            ],
          },
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      };

      const firstRun = await classifyTier2({
        definitions,
        transactions,
        batchSize: 1,
        checkpointFile: checkpointPath,
        classifier,
      });
      expect(firstRun).toHaveLength(2);
      expect(calls).toBe(2);

      const throwingClassifier: Tier2Classifier = async () => {
        throw new Error("classifier should not be called");
      };
      const secondRun = await classifyTier2({
        definitions,
        transactions,
        batchSize: 1,
        checkpointFile: checkpointPath,
        classifier: throwingClassifier,
      });
      expect(secondRun).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reclassifies when prompt inputs change", async () => {
    const dir = await makeTempDir();
    const checkpointPath = path.join(dir, "tier2.checkpoint.json");
    try {
      const transactions = [enrichedTransaction("txn-1", "OpenAI")];
      let calls = 0;
      const classifier: Tier2Classifier = async () => {
        calls++;
        return softwareClassification();
      };

      await classifyTier2({
        definitions,
        transactions,
        batchSize: 1,
        checkpointFile: checkpointPath,
        classifier,
      });

      const changedDefinitions: CategoryDefinition[] = [
        {
          id: "cat-shopping",
          name: "Shopping",
          group: "Expenses",
          description: "Changed shopping definition",
          examples: [],
          notThisCategory: [],
        },
        {
          id: "cat-software",
          name: "Software",
          group: "Expenses",
          description: "Software and SaaS",
          examples: ["OpenAI"],
          notThisCategory: [],
        },
      ];

      await classifyTier2({
        definitions: changedDefinitions,
        transactions,
        batchSize: 1,
        checkpointFile: checkpointPath,
        classifier,
      });

      expect(calls).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("checkpoints fulfilled sibling batches before rethrowing a failure", async () => {
    const dir = await makeTempDir();
    const checkpointPath = path.join(dir, "tier2.checkpoint.json");
    try {
      const transactions = [
        enrichedTransaction("txn-1", "OpenAI"),
        enrichedTransaction("txn-2", "Fail Merchant"),
      ];
      const classifier: Tier2Classifier = async (prompt) => {
        if (prompt.includes("Fail Merchant")) {
          throw new Error("planned failure");
        }
        return softwareClassification();
      };

      await expect(
        classifyTier2({
          definitions,
          transactions,
          batchSize: 1,
          checkpointFile: checkpointPath,
          classifier,
        }),
      ).rejects.toThrow("planned failure");

      const checkpoint = await loadTier2Checkpoint(checkpointPath);
      expect(checkpoint.size()).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function softwareClassification(): ReturnType<Tier2Classifier> {
  return Promise.resolve({
    result: {
      transactions: [
        {
          transactionIndex: 0,
          categoryId: "cat-software",
          categoryName: "Software",
          confidence: "high",
          shouldSplit: false,
          splits: [],
        },
      ],
    },
    usage: { inputTokens: 100, outputTokens: 20 },
  });
}

function enrichedTransaction(
  id: string,
  merchantName: string,
): EnrichedTransaction {
  return {
    transaction: transaction(id, merchantName),
    enrichment: undefined,
    tier: 2,
    deepPath: "regular",
  };
}

function transaction(id: string, merchantName: string): MonarchTransaction {
  return {
    id,
    amount: -20,
    pending: false,
    date: "2026-05-23",
    hideFromReports: false,
    plaidName: merchantName,
    notes: "",
    isRecurring: false,
    reviewStatus: "",
    needsReview: false,
    isSplitTransaction: false,
    category: { id: "cat-shopping", name: "Shopping" },
    merchant: {
      id: `${id}-merchant`,
      name: merchantName,
      transactionsCount: 1,
    },
    account: { id: "account-1", displayName: "Credit Card" },
    tags: [],
  };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "monarch-tier2-test-"));
}
