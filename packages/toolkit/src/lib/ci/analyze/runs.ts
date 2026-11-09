import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { boundedBenchmarkBody } from "#lib/ci/benchmark-store.ts";

const BUCKET = "ci-handoff";
const MAX_DIAGNOSTIC_BYTES = 128 * 1024 ** 2;

/**
 * The fields of scripts/lib/ci/task-diagnostics.ts that the analysis reads.
 * Loose, because the producer owns the full contract; strict about every
 * field used here so a renamed one fails instead of reading as empty.
 */
const DiagnosticTaskSchema = z
  .object({
    taskId: z.string().min(1),
    hash: z.string().min(1),
    hashOfExternalDependencies: z.string().optional(),
    inputHashes: z.record(z.string(), z.string()).optional(),
    cache: z.object({ status: z.enum(["HIT", "MISS", "BYPASS"]) }).loose(),
    dependencies: z.array(z.string()),
    execution: z
      .object({
        startTime: z.number().nonnegative(),
        endTime: z.number().nonnegative().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const DiagnosticSuiteSchema = z
  .object({
    report: z.string().min(1),
    name: z.string().min(1),
    seconds: z.number().nonnegative(),
    tests: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
  })
  .loose();

const DiagnosticsSchema = z
  .object({
    pipeline: z.coerce.number().int().positive(),
    commit: z.string().regex(/^[a-f\d]{40}$/u),
    turbo: z.array(z.object({ tasks: z.array(DiagnosticTaskSchema) }).loose()),
    /** Per-suite JUnit timings; absent from diagnostics that predate them. */
    testTimings: z
      .object({ suites: z.array(DiagnosticSuiteSchema) })
      .loose()
      .optional(),
  })
  .loose();

const RunTaskSchema = z.object({
  id: z.string(),
  hash: z.string(),
  status: z.enum(["HIT", "MISS", "BYPASS"]),
  /** Execution seconds; a cache hit restores in well under one. */
  seconds: z.number().nonnegative(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  dependencies: z.array(z.string()),
  /** Digest of the task's own file inputs and external dependencies only. */
  ownInputs: z.string(),
});
export type RunTask = z.infer<typeof RunTaskSchema>;

const RunSuiteSchema = z.object({
  /** `<workspace-dir>/<step>.xml` under the run's `.ci-reports/junit`. */
  report: z.string(),
  /** The `<workspace>::`-prefixed JUnit suite name, usually a test file. */
  name: z.string(),
  seconds: z.number().nonnegative(),
  tests: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
});
export type RunSuite = z.infer<typeof RunSuiteSchema>;

const VerifyRunSchema = z.object({
  pipeline: z.number().int().positive(),
  commit: z.string(),
  tasks: z.array(RunTaskSchema),
  /** Null when the diagnostics predate per-suite timings, not when none ran. */
  suites: z.array(RunSuiteSchema).nullable(),
});
export type VerifyRun = z.infer<typeof VerifyRunSchema>;

/**
 * Compacted-run cache format. Bumped when `VerifyRun` gains a field, so a
 * compaction written before the field existed is re-read from the source
 * instead of parsing as a run that lacks it.
 */
const CACHE_FORMAT = 2;

function ownInputsDigest(task: z.infer<typeof DiagnosticTaskSchema>): string {
  const inputs = Object.entries(task.inputHashes ?? {}).toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  return createHash("sha256")
    .update(JSON.stringify([inputs, task.hashOfExternalDependencies ?? null]))
    .digest("hex")
    .slice(0, 16);
}

/** One verify run's per-task record, without input paths or hashes. */
export function compactDiagnostics(raw: unknown): VerifyRun {
  const diagnostics = DiagnosticsSchema.parse(raw);
  const tasks = diagnostics.turbo.flatMap((run) =>
    run.tasks.flatMap((task): RunTask[] => {
      const execution = task.execution;
      if (execution?.endTime === undefined) return [];
      return [
        {
          id: task.taskId,
          hash: task.hash,
          status: task.cache.status,
          seconds: Math.max(0, execution.endTime - execution.startTime) / 1000,
          start: execution.startTime,
          end: execution.endTime,
          dependencies: task.dependencies,
          ownInputs: ownInputsDigest(task),
        },
      ];
    }),
  );
  return {
    pipeline: diagnostics.pipeline,
    commit: diagnostics.commit,
    tasks,
    suites:
      diagnostics.testTimings?.suites.map(
        ({ report, name, seconds, tests, failures }) => ({
          report,
          name,
          seconds,
          tests,
          failures,
        }),
      ) ?? null,
  };
}

export function analyzeCacheDirectory(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  return path.join(
    environment["XDG_CACHE_HOME"] ?? path.join(os.homedir(), ".cache"),
    "toolkit",
    "ci-analyze",
  );
}

function isMissingObject(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")
  );
}

/**
 * The verify step's diagnostics object, or the nightly extended run's for a
 * pipeline that has no PR-shaped verify. Null when the pipeline wrote neither.
 */
const DIAGNOSTIC_OBJECTS = [
  "diagnostics-verify.json",
  "diagnostics-verify-extended.json",
] as const;

async function diagnosticsBody(
  client: S3Client,
  pipeline: number,
): Promise<Uint8Array | null> {
  for (const object of DIAGNOSTIC_OBJECTS) {
    const signal = AbortSignal.timeout(120_000);
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: `${String(pipeline)}/${object}`,
        }),
        { abortSignal: signal },
      );
      if (response.Body === undefined)
        throw new Error(
          `Pipeline ${String(pipeline)} diagnostics have no body`,
        );
      return await boundedBenchmarkBody(
        response.Body.transformToWebStream(),
        MAX_DIAGNOSTIC_BYTES,
        signal,
      );
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  }
  return null;
}

/**
 * A finished pipeline's verify (or verify-extended) diagnostics, compacted
 * and cached locally: the source objects are about 50 MB each. Null when the
 * pipeline wrote none.
 */
export async function loadVerifyRun(
  client: S3Client,
  pipeline: number,
  cacheDirectory: string,
): Promise<VerifyRun | null> {
  const cached = Bun.file(
    path.join(
      cacheDirectory,
      `${String(pipeline)}.v${String(CACHE_FORMAT)}.json`,
    ),
  );
  if (await cached.exists()) return VerifyRunSchema.parse(await cached.json());
  const body = await diagnosticsBody(client, pipeline);
  if (body === null) return null;
  const run = compactDiagnostics(JSON.parse(new TextDecoder().decode(body)));
  await mkdir(cacheDirectory, { recursive: true });
  await Bun.write(cached, JSON.stringify(run));
  return run;
}
