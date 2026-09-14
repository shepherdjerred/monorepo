import { z } from "zod";

export const SANDBOX_PORT = 8090;
export const SANDBOX_TIMEOUT_MS = 10_000;
export const SANDBOX_MAX_SOURCE_BYTES = 20 * 1024;
export const SANDBOX_MAX_STDIN_BYTES = 10 * 1024;
export const SANDBOX_MAX_OUTPUT_BYTES = 64 * 1024;
export const SANDBOX_UIDS = [1001, 1002] as const;
export const SANDBOX_MAX_CONCURRENCY = SANDBOX_UIDS.length;

function boundedUtf8String(maxBytes: number, field: string) {
  return z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= maxBytes,
      `${field} exceeds ${String(maxBytes)} UTF-8 bytes`,
    );
}

export const RunCodeRequestSchema = z.object({
  language: z.enum(["python", "javascript", "typescript"]),
  source: boundedUtf8String(SANDBOX_MAX_SOURCE_BYTES, "source"),
  stdin: boundedUtf8String(SANDBOX_MAX_STDIN_BYTES, "stdin").optional(),
});

export const RunCodeResultDataSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});

export const RunCodeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: RunCodeResultDataSchema.optional(),
});

export type RunCodeRequest = z.infer<typeof RunCodeRequestSchema>;
export type RunCodeResponse = z.infer<typeof RunCodeResponseSchema>;
