import { createHash } from "node:crypto";
import { z } from "zod";

/** Input of a `test` stage Job: one package script run at the frozen source revision (V5). */
export const TestStageInputSchema = z
  .object({
    suite: z.string().regex(/^[a-z][a-z0-9:-]{0,63}$/u),
    workspace: z
      .string()
      .regex(/^packages\/[a-z0-9-]+(?:\/packages\/[a-z0-9-]+)?$/u),
  })
  .strict();
export type TestStageInput = z.infer<typeof TestStageInputSchema>;

export const TestStageResultSchema = z
  .object({
    schema: z.literal("delivery-test-stage/v1"),
    suite: TestStageInputSchema.shape.suite,
    workspace: TestStageInputSchema.shape.workspace,
    exitCode: z.number().int(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    reportSha256: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable(),
    failures: z.array(z.string().max(200)).max(200),
    truncated: z.boolean(),
  })
  .strict();
export type TestStageResult = z.infer<typeof TestStageResultSchema>;

/** The result line is bounded; counts are never dropped, only failure names. */
export const TEST_STAGE_RESULT_BOUND = 32 * 1024;

const VitestReportSchema = z
  .object({
    numPassedTests: z.number().int().nonnegative(),
    numFailedTests: z.number().int().nonnegative(),
    startTime: z.number().optional(),
    testResults: z
      .array(
        z
          .object({
            name: z.string(),
            assertionResults: z
              .array(
                z
                  .object({
                    fullName: z.string(),
                    status: z.string(),
                  })
                  .loose(),
              )
              .default([]),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

export function reportSha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Builds the bounded result from a vitest JSON report (or none for a suite
 * that produces no report). Failure names are truncated to fit the bound.
 */
export function testStageResult(input: {
  suite: string;
  workspace: string;
  exitCode: number;
  durationMs: number;
  report: Uint8Array | null;
}): TestStageResult {
  const base = {
    schema: "delivery-test-stage/v1" as const,
    suite: input.suite,
    workspace: input.workspace,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
  };
  if (input.report === null)
    return TestStageResultSchema.parse({
      ...base,
      passed: 0,
      failed: input.exitCode === 0 ? 0 : 1,
      reportSha256: null,
      failures: [],
      truncated: false,
    });
  const parsed = VitestReportSchema.parse(
    JSON.parse(new TextDecoder().decode(input.report)),
  );
  const failures = parsed.testResults.flatMap((file) =>
    file.assertionResults
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => `${file.name}: ${assertion.fullName}`.slice(0, 200)),
  );
  let kept = failures.slice(0, 200);
  let truncated = kept.length < failures.length;
  const build = () =>
    TestStageResultSchema.parse({
      ...base,
      passed: parsed.numPassedTests,
      failed: parsed.numFailedTests,
      reportSha256: reportSha256(input.report ?? new Uint8Array()),
      failures: kept,
      truncated,
    });
  let result = build();
  while (JSON.stringify(result).length > TEST_STAGE_RESULT_BOUND) {
    if (kept.length === 0)
      throw new Error("Test stage result exceeds its bound without failures");
    kept = kept.slice(0, Math.max(0, Math.floor(kept.length / 2)));
    truncated = true;
    result = build();
  }
  return result;
}

/** Whether a package script runs vitest, so the JSON reporter can be requested. */
export function suiteUsesVitest(script: string): boolean {
  return /\bvitest\b/u.test(script);
}
