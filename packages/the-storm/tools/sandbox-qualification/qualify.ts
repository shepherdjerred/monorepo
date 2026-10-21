/**
 * `qualify:sandbox`: runs the named extended Paper suites, in order, against
 * already-running qualification servers and writes one evidence report
 * (`report.ts`). Each suite gets its own freshly booted server, declared by
 * `STORM_QUALIFY_<SUITE>_*` variables that map onto the suite's external
 * server inputs (`tests/e2e/harness/external/inputs.ts`).
 *
 * Exit codes: 0 every suite passed; 1 the run failed and the report says why;
 * 2 the invocation or a declared input is invalid and no suite ran.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  parseExternalServer,
  type ExternalServer,
} from "#e2e/harness/external/inputs.ts";
import {
  QUALIFICATION_REPORT_VERSION,
  QualificationReportSchema,
  ServerImageSchema,
  SourceRevisionSchema,
  SuiteNameSchema,
  type QualificationReport,
  type SuiteName,
  type SuiteReport,
} from "./report.ts";

export const packageRoot = path.resolve(import.meta.dirname, "..", "..");

/** The suites a qualification run can name, with their ceilings. */
export const SUITES = {
  e2e: { script: "test:e2e", profile: "e2e", timeoutMinutes: 60 },
  full: { script: "test:full", profile: "full", timeoutMinutes: 120 },
} as const satisfies Record<
  SuiteName,
  { script: string; profile: "e2e" | "full"; timeoutMinutes: number }
>;

/** The per-suite variables, `STORM_QUALIFY_<SUITE>_<NAME>`. */
const TARGET_NAMES = [
  "HOST",
  "GAME_PORT",
  "RCON_PORT",
  "RCON_PASSWORD",
  "BRAIN_HOST",
  "BRAIN_PORT",
  "FILES_URL",
  "FILES_TOKEN",
  "QUERY_PORT",
] as const;

const TARGET_NAME_SET: ReadonlySet<string> = new Set(TARGET_NAMES);

const E2E_PREFIX = "STORM_E2E_";
const QUALIFY_PREFIX = "STORM_QUALIFY_";

export function targetPrefix(suite: SuiteName): string {
  return `${QUALIFY_PREFIX}${suite.toUpperCase()}_`;
}

type Environment = Readonly<Record<string, string | undefined>>;

/** A declared input is missing or malformed; nothing ran. */
export class InvocationError extends Error {}

export type SuiteTarget = {
  suite: SuiteName;
  external: ExternalServer;
  /** The child environment: the parent's, minus every Storm suite input, plus this target. */
  env: Record<string, string>;
};

export type Invocation = {
  reportPath: string;
  serverImage: string;
  sourceRevision: string;
  targets: SuiteTarget[];
};

function targetEnvironment(
  suite: SuiteName,
  env: Environment,
  problems: string[],
): Record<string, string> {
  const prefix = targetPrefix(suite);
  const mapped: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.startsWith(prefix)) continue;
    const input = name.slice(prefix.length);
    if (!TARGET_NAME_SET.has(input)) {
      problems.push(
        `${name} is not a qualification input (expected ${prefix}{${TARGET_NAMES.join(",")}})`,
      );
      continue;
    }
    mapped[`${E2E_PREFIX}${input}`] = value;
  }
  return mapped;
}

function childEnvironment(
  env: Environment,
  target: Record<string, string>,
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [name, value] of Object.entries(env))
    if (
      value !== undefined &&
      !name.startsWith(E2E_PREFIX) &&
      !name.startsWith(QUALIFY_PREFIX)
    )
      child[name] = value;
  return { ...child, ...target };
}

function parseFlags(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        report: { type: "string" },
        "server-image": { type: "string" },
        "source-revision": { type: "string" },
        suite: { type: "string", multiple: true },
      },
    });
  } catch (error) {
    throw new InvocationError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Parses the command line and every named suite's server; throws InvocationError. */
export function parseInvocation(
  argv: readonly string[],
  env: Environment,
): Invocation {
  const { values } = parseFlags(argv);
  const problems: string[] = [];
  const field = <T>(name: string, schema: z.ZodType<T>, value: unknown) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    problems.push(
      value === undefined
        ? `--${name} is required`
        : `--${name} is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
    return;
  };
  const reportPath = field("report", z.string().min(1), values.report);
  const serverImage = field(
    "server-image",
    ServerImageSchema,
    values["server-image"],
  );
  const sourceRevision = field(
    "source-revision",
    SourceRevisionSchema,
    values["source-revision"],
  );
  const suites = field(
    "suite",
    z
      .array(SuiteNameSchema)
      .min(1)
      .refine((names) => new Set(names).size === names.length, {
        message: "a suite runs only once",
      }),
    values.suite,
  );
  const targets: SuiteTarget[] = [];
  for (const suite of suites ?? []) {
    const mapped = targetEnvironment(suite, env, problems);
    try {
      const external = parseExternalServer(mapped, SUITES[suite].profile);
      if (external.server.files.kind !== "http")
        problems.push(
          `${targetPrefix(suite)}FILES_URL and FILES_TOKEN must declare the server files service`,
        );
      targets.push({ suite, external, env: childEnvironment(env, mapped) });
    } catch (error) {
      problems.push(
        `${suite} suite (${targetPrefix(suite)}*): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const endpoints = targets.map(
    ({ external: { server } }) =>
      `${server.host}:${server.gamePort.toString()}`,
  );
  if (new Set(endpoints).size !== endpoints.length)
    problems.push(
      "Each suite needs its own freshly booted server; two suites name the same host and game port",
    );
  if (
    reportPath === undefined ||
    serverImage === undefined ||
    sourceRevision === undefined ||
    problems.length > 0
  )
    throw new InvocationError(
      `qualify:sandbox cannot start:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
  return {
    reportPath: path.resolve(reportPath),
    serverImage,
    sourceRevision,
    targets,
  };
}

/** The part of Vitest's JSON reporter output the report reads. */
const VitestJsonSchema = z.object({
  testResults: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(["passed", "failed"]),
      message: z.string(),
      assertionResults: z.array(
        z.object({
          fullName: z.string().min(1),
          status: z.enum([
            "passed",
            "failed",
            "skipped",
            "pending",
            "todo",
            "disabled",
          ]),
          duration: z.number().nullish(),
          failureMessages: z.array(z.string()).nullable(),
        }),
      ),
    }),
  ),
});

/** What running one suite produced. */
export type SuiteRun = {
  /** Null when the suite was killed at its ceiling. */
  exitCode: number | null;
  timedOut: boolean;
  /** Vitest's JSON report, or null when the run wrote none. */
  vitestJson: unknown;
};

export type QualifyDependencies = {
  now: () => Date;
  /** Fails when the server already served a qualification run. */
  claimServer: (target: SuiteTarget) => Promise<void>;
  runSuite: (target: SuiteTarget, timeoutMs: number) => Promise<SuiteRun>;
  log: (line: string) => void;
};

const MESSAGE_LIMIT = 4000;

function trimmed(message: string): string {
  return message.length <= MESSAGE_LIMIT
    ? message
    : `${message.slice(0, MESSAGE_LIMIT)}… (${(message.length - MESSAGE_LIMIT).toString()} more characters)`;
}

function relativeTestFile(file: string): string {
  return path.relative(packageRoot, file).split(path.sep).join("/");
}

type Outcome = Pick<
  SuiteReport,
  "outcome" | "exitCode" | "tests" | "failures" | "skipped" | "error"
>;

const NO_TESTS = { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 };

function errored(error: string, exitCode: number | null): Outcome {
  return {
    outcome: "error",
    exitCode,
    tests: NO_TESTS,
    failures: [],
    skipped: [],
    error,
  };
}

type VitestFile = z.infer<typeof VitestJsonSchema>["testResults"][number];
type Tally = Pick<Outcome, "tests" | "failures" | "skipped">;

function record(
  tally: Tally,
  file: string,
  result: VitestFile["assertionResults"][number],
): void {
  tally.tests.total++;
  switch (result.status) {
    case "passed": {
      tally.tests.passed++;
      return;
    }
    case "failed": {
      tally.tests.failed++;
      const messages = (result.failureMessages ?? []).map((message) =>
        trimmed(message),
      );
      tally.failures.push({
        file,
        test: result.fullName,
        messages: messages.length > 0 ? messages : ["failed without a message"],
        durationMs: result.duration ?? null,
      });
      return;
    }
    case "todo": {
      tally.tests.todo++;
      return;
    }
    case "skipped":
    case "pending":
    case "disabled": {
      tally.tests.skipped++;
      tally.skipped.push({ file, test: result.fullName });
      return;
    }
  }
}

/** Counts, failures (including file-level errors) and skips across the run. */
function tallyFiles(files: VitestFile[]): Tally {
  const tally: Tally = { tests: { ...NO_TESTS }, failures: [], skipped: [] };
  for (const file of files) {
    const relative = relativeTestFile(file.name);
    if (file.message !== "")
      tally.failures.push({
        file: relative,
        test: null,
        messages: [trimmed(file.message)],
        durationMs: null,
      });
    for (const result of file.assertionResults) record(tally, relative, result);
  }
  return tally;
}

/** Why a run without listed failures still did not pass, if it did not. */
function unexplained(exitCode: number | null, tally: Tally): string | null {
  if (tally.failures.length > 0) return null;
  if (exitCode !== 0)
    return `vitest exited ${String(exitCode)} without a failing test; see the job log`;
  return tally.tests.passed === 0 ? "the suite ran no passing test" : null;
}

/** Summarizes one suite's Vitest run into its report outcome. */
export function summarizeRun(run: SuiteRun, timeoutMinutes: number): Outcome {
  if (run.timedOut)
    return errored(
      `the suite exceeded its ${timeoutMinutes.toString()}-minute ceiling and was stopped`,
      null,
    );
  if (run.vitestJson === null)
    return errored(
      `vitest exited ${String(run.exitCode)} without a JSON report; see the job log`,
      run.exitCode,
    );
  const parsed = VitestJsonSchema.safeParse(run.vitestJson);
  if (!parsed.success)
    return errored(
      `vitest wrote an unreadable JSON report: ${z.prettifyError(parsed.error)}`,
      run.exitCode,
    );
  const tally = tallyFiles(parsed.data.testResults);
  const error = unexplained(run.exitCode, tally);
  const passed =
    error === null && tally.failures.length === 0 && run.exitCode === 0;
  return {
    outcome: passed ? "passed" : "failed",
    exitCode: run.exitCode,
    ...tally,
    error,
  };
}

async function runOne(
  target: SuiteTarget,
  dependencies: QualifyDependencies,
): Promise<SuiteReport> {
  const suite = SUITES[target.suite];
  const started = dependencies.now();
  let outcome: Outcome;
  try {
    await dependencies.claimServer(target);
    dependencies.log(
      `[qualify] ${target.suite}: bun run ${suite.script} against ${target.external.server.host}:${target.external.server.gamePort.toString()}`,
    );
    const run = await dependencies.runSuite(
      target,
      suite.timeoutMinutes * 60_000,
    );
    outcome = summarizeRun(run, suite.timeoutMinutes);
  } catch (error) {
    outcome = errored(
      error instanceof Error ? error.message : String(error),
      null,
    );
  }
  const finished = dependencies.now();
  return {
    name: target.suite,
    command: `bun run ${suite.script}`,
    target: {
      host: target.external.server.host,
      gamePort: target.external.server.gamePort,
    },
    ...outcome,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
  };
}

/** Runs every named suite in order, even after a failure, and returns the validated report. */
export async function runQualification(
  invocation: Invocation,
  dependencies: QualifyDependencies,
): Promise<QualificationReport> {
  const started = dependencies.now();
  const suites: SuiteReport[] = [];
  for (const target of invocation.targets) {
    const report = await runOne(target, dependencies);
    dependencies.log(
      `[qualify] ${report.name}: ${report.outcome} (${report.tests.passed.toString()} passed, ${report.tests.failed.toString()} failed, ${report.tests.skipped.toString()} skipped)`,
    );
    suites.push(report);
  }
  const finished = dependencies.now();
  return QualificationReportSchema.parse({
    schemaVersion: QUALIFICATION_REPORT_VERSION,
    sourceRevision: invocation.sourceRevision,
    serverImage: invocation.serverImage,
    outcome: suites.every((suite) => suite.outcome === "passed")
      ? "passed"
      : "failed",
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
    suites,
  });
}

/** The whole entrypoint: parse, run, write the report, and return the exit code. */
export async function main(
  argv: readonly string[],
  env: Environment,
  dependencies: QualifyDependencies,
): Promise<number> {
  let invocation: Invocation;
  try {
    invocation = parseInvocation(argv, env);
  } catch (error) {
    if (!(error instanceof InvocationError)) throw error;
    console.error(error.message);
    return 2;
  }
  const report = await runQualification(invocation, dependencies);
  await mkdir(path.dirname(invocation.reportPath), { recursive: true });
  // Evidence is never overwritten: a second run needs a new report path.
  await writeFile(
    invocation.reportPath,
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx", mode: 0o644 },
  );
  dependencies.log(
    `[qualify] ${report.outcome}; report written to ${invocation.reportPath}`,
  );
  return report.outcome === "passed" ? 0 : 1;
}
