import { createHash } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProposedChange } from "./types.ts";

const CHECKPOINT_SCHEMA_VERSION = 1;

const ProposedSplitSchema = z.object({
  itemName: z.string(),
  amount: z.number(),
  categoryId: z.string(),
  categoryName: z.string(),
  date: z.string().optional(),
});

const ProposedChangeSchema = z.object({
  transactionId: z.string(),
  transactionDate: z.string(),
  merchantName: z.string(),
  amount: z.number(),
  currentCategory: z.string(),
  currentCategoryId: z.string(),
  proposedCategory: z.string(),
  proposedCategoryId: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  type: z.enum(["recategorize", "split", "flag"]),
  splits: z.array(ProposedSplitSchema).optional(),
  reason: z.string().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  enrichmentSource: z.string().optional(),
});

const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

const Tier2CheckpointBatchSchema = z.object({
  transactionIds: z.array(z.string()),
  model: z.string(),
  batchSize: z.number().int().positive(),
  promptHash: z.string(),
  completedAt: z.string(),
  changes: z.array(ProposedChangeSchema),
  usage: TokenUsageSchema.optional(),
});

const Tier2CheckpointFileSchema = z.object({
  schemaVersion: z.literal(CHECKPOINT_SCHEMA_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),
  batches: z.record(z.string(), Tier2CheckpointBatchSchema),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type Tier2CheckpointBatch = z.infer<typeof Tier2CheckpointBatchSchema>;
export type Tier2CheckpointFile = z.infer<typeof Tier2CheckpointFileSchema>;

export type Tier2BatchIdentity = {
  prompt: string;
  model: string;
  batchSize: number;
  webSearchEnabled: boolean;
  transactionIds: string[];
};

export type Tier2CheckpointStore = {
  path: string;
  get: (key: string) => Tier2CheckpointBatch | undefined;
  set: (key: string, entry: Tier2CheckpointBatch) => Promise<void>;
  size: () => number;
};

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function getTier2PromptHash(prompt: string): string {
  return hashString(prompt);
}

export function getTier2BatchKey(identity: Tier2BatchIdentity): string {
  return hashString(
    JSON.stringify({
      promptHash: getTier2PromptHash(identity.prompt),
      model: identity.model,
      batchSize: identity.batchSize,
      webSearchEnabled: identity.webSearchEnabled,
      transactionIds: identity.transactionIds,
    }),
  );
}

function emptyCheckpoint(): Tier2CheckpointFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    batches: {},
  };
}

async function writeCheckpoint(
  filePath: string,
  checkpoint: Tier2CheckpointFile,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await Bun.write(tempPath, JSON.stringify(checkpoint, null, 2));
  await rename(tempPath, filePath);
}

export async function loadTier2Checkpoint(
  filePath: string,
): Promise<Tier2CheckpointStore> {
  const file = Bun.file(filePath);
  let checkpoint = emptyCheckpoint();

  if (await file.exists()) {
    const raw: unknown = JSON.parse(await file.text());
    checkpoint = Tier2CheckpointFileSchema.parse(raw);
  }

  return {
    path: filePath,
    get(key: string): Tier2CheckpointBatch | undefined {
      return checkpoint.batches[key];
    },
    async set(key: string, entry: Tier2CheckpointBatch): Promise<void> {
      checkpoint = {
        ...checkpoint,
        updatedAt: new Date().toISOString(),
        batches: {
          ...checkpoint.batches,
          [key]: entry,
        },
      };
      await writeCheckpoint(filePath, checkpoint);
    },
    size(): number {
      return Object.keys(checkpoint.batches).length;
    },
  };
}

export function buildTier2CheckpointBatch(params: {
  transactionIds: string[];
  model: string;
  batchSize: number;
  promptHash: string;
  changes: ProposedChange[];
  usage: TokenUsage | undefined;
}): Tier2CheckpointBatch {
  return {
    transactionIds: params.transactionIds,
    model: params.model,
    batchSize: params.batchSize,
    promptHash: params.promptHash,
    completedAt: new Date().toISOString(),
    changes: params.changes,
    ...(params.usage === undefined ? {} : { usage: params.usage }),
  };
}
