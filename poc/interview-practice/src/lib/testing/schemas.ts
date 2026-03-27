import { z } from "zod/v4";

export const TestResultSchema = z.object({
  passed: z.boolean(),
  actual: z.string(),
  expected: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
  timedOut: z.boolean(),
});

export const TestRunResultSchema = z.object({
  passed: z.number().int(),
  failed: z.number().int(),
  total: z.number().int(),
  results: z.array(TestResultSchema),
  compileError: z.string().nullable(),
});

export type TestResultType = z.infer<typeof TestResultSchema>;
export type TestRunResultType = z.infer<typeof TestRunResultSchema>;
