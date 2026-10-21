/**
 * The evidence `qualify:sandbox` writes: one report per qualification run of
 * the extended Paper suites against the `minecraft/sandbox` servers. The
 * README's "Sandbox qualification" section documents every field.
 */
import { z } from "zod";

export const QUALIFICATION_REPORT_VERSION = 1;
/** The only image a Storm qualification run may name as its server under test. */
export const STORM_SERVER_REPOSITORY =
  "docker.io/shepherdjerred/the-storm-server";

export const SuiteNameSchema = z.enum(["e2e", "full"]);
export type SuiteName = z.infer<typeof SuiteNameSchema>;

export const ServerImageSchema = z
  .string()
  .regex(
    /^docker\.io\/shepherdjerred\/the-storm-server@sha256:[0-9a-f]{64}$/u,
    `expected ${STORM_SERVER_REPOSITORY}@sha256:<64 hex>`,
  );
export const SourceRevisionSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/u, "expected a full 40-character commit SHA");

const Count = z.number().int().nonnegative();
const Timestamp = z.iso.datetime({ offset: false });
/** A test file, relative to `packages/the-storm` (for example `tests/e2e/rwf.e2e.test.ts`). */
const TestFile = z.string().min(1);

const TestCountsSchema = z.strictObject({
  total: Count,
  passed: Count,
  failed: Count,
  skipped: Count,
  todo: Count,
});

const FailureSchema = z.strictObject({
  file: TestFile,
  /** The full test name (describe blocks and title), or null for a file-level error. */
  test: z.string().min(1).nullable(),
  messages: z.array(z.string()).min(1),
  durationMs: z.number().nonnegative().nullable(),
});

const SkippedSchema = z.strictObject({
  file: TestFile,
  test: z.string().min(1),
});

export const SuiteReportSchema = z
  .strictObject({
    name: SuiteNameSchema,
    command: z.string().min(1),
    /** The server this suite ran against; credentials are never recorded. */
    target: z.strictObject({
      host: z.string().min(1),
      gamePort: z.number().int().min(1).max(65_535),
    }),
    outcome: z.enum(["passed", "failed", "error"]),
    /** Vitest's exit code, or null when the suite never started or was killed. */
    exitCode: z.number().int().nullable(),
    startedAt: Timestamp,
    finishedAt: Timestamp,
    durationMs: z.number().int().nonnegative(),
    tests: TestCountsSchema,
    failures: z.array(FailureSchema),
    skipped: z.array(SkippedSchema),
    /** Why the suite errored or failed beyond its failing tests. */
    error: z.string().min(1).nullable(),
  })
  .superRefine((suite, context) => {
    const { tests } = suite;
    const problem = (message: string) => {
      context.addIssue({ code: "custom", message });
    };
    if (
      tests.total !==
      tests.passed + tests.failed + tests.skipped + tests.todo
    )
      problem("tests.total must equal passed + failed + skipped + todo");
    if (
      suite.failures.filter((failure) => failure.test !== null).length !==
      tests.failed
    )
      problem("every failed test must be listed in failures");
    if (suite.skipped.length !== tests.skipped)
      problem("every skipped test must be listed in skipped");
    if (suite.finishedAt < suite.startedAt)
      problem("finishedAt precedes startedAt");
    if (
      suite.outcome === "passed" &&
      (suite.exitCode !== 0 ||
        suite.failures.length > 0 ||
        suite.error !== null ||
        tests.passed === 0)
    )
      problem(
        "a passed suite exits 0 with at least one passing test, no failures and no error",
      );
    if (
      suite.outcome !== "passed" &&
      suite.error === null &&
      suite.failures.length === 0
    )
      problem("a suite that did not pass names a failure or an error");
    if (suite.outcome === "error" && suite.error === null)
      problem("an errored suite says why");
  });
export type SuiteReport = z.infer<typeof SuiteReportSchema>;

export const QualificationReportSchema = z
  .strictObject({
    schemaVersion: z.literal(QUALIFICATION_REPORT_VERSION),
    sourceRevision: SourceRevisionSchema,
    serverImage: ServerImageSchema,
    outcome: z.enum(["passed", "failed"]),
    startedAt: Timestamp,
    finishedAt: Timestamp,
    durationMs: z.number().int().nonnegative(),
    suites: z.array(SuiteReportSchema).min(1),
  })
  .superRefine((report, context) => {
    const names = report.suites.map((suite) => suite.name);
    if (new Set(names).size !== names.length)
      context.addIssue({ code: "custom", message: "a suite runs only once" });
    const passed = report.suites.every((suite) => suite.outcome === "passed");
    if ((report.outcome === "passed") !== passed)
      context.addIssue({
        code: "custom",
        message: "the run passes exactly when every suite passed",
      });
    if (report.finishedAt < report.startedAt)
      context.addIssue({
        code: "custom",
        message: "finishedAt precedes startedAt",
      });
  });
export type QualificationReport = z.infer<typeof QualificationReportSchema>;
