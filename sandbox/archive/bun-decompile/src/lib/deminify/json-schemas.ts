/**
 * Zod schemas for safely parsing JSON from disk/network.
 * Replaces unsafe `JSON.parse() as Type` patterns.
 */

import { z } from "zod";

/** DeminifyResult schema (nested in CacheEntry) */
const DeminifyResultSchema = z.object({
  functionId: z.string(),
  originalSource: z.string(),
  deminifiedSource: z.string(),
  suggestedName: z.string(),
  confidence: z.number(),
  parameterNames: z.record(z.string(), z.string()),
  localVariableNames: z.record(z.string(), z.string()),
});

/** CacheEntry schema for file-based cache */
export const CacheEntrySchema = z.object({
  hash: z.string(),
  result: DeminifyResultSchema,
  timestamp: z.number(),
  modelVersion: z.string(),
});

/** FunctionRenameMapping schema (nested in CachedRenameResult) */
const FunctionRenameMappingSchema = z.object({
  functionName: z.string().optional(),
  description: z.string().optional(),
  renames: z.record(z.string(), z.string()),
});

/** CachedRenameResult schema for function cache */
export const CachedRenameResultSchema = z.object({
  hash: z.string(),
  mapping: FunctionRenameMappingSchema,
  timestamp: z.number(),
  model: z.string(),
});

/** BatchState schema for batch resume support */
export const BatchStateSchema = z.object({
  batchId: z.string(),
  sourceHash: z.string(),
  outputPath: z.string(),
  createdAt: z.number(),
  model: z.string(),
  functionCount: z.number(),
  fileName: z.string(),
  projectId: z.string(),
});

/** BatchResponse line schema for OpenAI batch results */
export const BatchResponseSchema = z.object({
  id: z.string(),
  custom_id: z.string(),
  response: z
    .object({
      status_code: z.number(),
      request_id: z.string(),
      body: z.object({
        id: z.string(),
        object: z.string(),
        created: z.number(),
        model: z.string(),
        choices: z.array(
          z.object({
            index: z.number(),
            message: z.object({
              role: z.string(),
              content: z.string(),
            }),
            finish_reason: z.string(),
          }),
        ),
        usage: z.object({
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          total_tokens: z.number(),
        }),
      }),
    })
    .nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});
