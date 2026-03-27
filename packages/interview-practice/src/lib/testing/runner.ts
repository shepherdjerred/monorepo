import path from "node:path";
import { getLanguageConfig } from "./languages.ts";
import type { TestCase, FunctionSignature } from "#lib/questions/schemas.ts";

export type TestResult = {
  passed: boolean;
  actual: string;
  expected: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type TestRunResult = {
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
  compileError: string | null;
}

function generateTestHarness(
  solutionPath: string,
  testCases: TestCase[],
  signature: FunctionSignature,
): string {
  const solutionBase = path.basename(solutionPath, path.extname(solutionPath));
  const importPath = `./${solutionBase}.ts`;

  const testCasesJson = JSON.stringify(
    testCases.map((tc) => ({ args: tc.args, expected: tc.expected })),
  );

  return `import { ${signature.name} } from "${importPath}";

const testCases = ${testCasesJson};

const results = [];
for (const tc of testCases) {
  const start = Date.now();
  try {
    const actual = ${signature.name}(...tc.args);
    const passed = JSON.stringify(actual) === JSON.stringify(tc.expected);
    results.push({ passed, actual, expected: tc.expected, error: null, durationMs: Date.now() - start });
  } catch (e) {
    results.push({ passed: false, actual: null, expected: tc.expected, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start });
  }
}

console.log(JSON.stringify(results));
`;
}

import { z } from "zod/v4";

const harnessResultParser = z.array(z.object({
  passed: z.boolean(),
  actual: z.unknown(),
  expected: z.unknown(),
  error: z.string().nullable(),
  durationMs: z.number(),
}));

export async function runTests(
  solutionPath: string,
  testCases: TestCase[],
  signature?: FunctionSignature,
): Promise<TestRunResult> {
  const ext = "." + (path.basename(solutionPath).split(".").pop() ?? "");
  const langConfig = getLanguageConfig(ext);

  if (!langConfig) {
    return {
      passed: 0,
      failed: testCases.length,
      total: testCases.length,
      results: testCases.map((tc) => ({
        passed: false,
        actual: "",
        expected: formatExpected(tc.expected),
        stderr: `Unsupported language: ${ext}`,
        durationMs: 0,
        timedOut: false,
      })),
      compileError: `Unsupported language extension: ${ext}`,
    };
  }

  // For TypeScript with a function signature, use the test harness approach
  if (ext === ".ts" && signature !== undefined) {
    return runWithHarness(solutionPath, testCases, signature, langConfig.runTimeout);
  }

  // Fallback for languages without harness support
  return {
    passed: 0,
    failed: testCases.length,
    total: testCases.length,
    results: testCases.map((tc) => ({
      passed: false,
      actual: "",
      expected: formatExpected(tc.expected),
      stderr: `Function-call testing not yet supported for ${ext}`,
      durationMs: 0,
      timedOut: false,
    })),
    compileError: null,
  };
}

async function runWithHarness(
  solutionPath: string,
  testCases: TestCase[],
  signature: FunctionSignature,
  timeout: number,
): Promise<TestRunResult> {
  const dir = path.dirname(solutionPath);
  const harnessPath = path.join(dir, "__test_harness.ts");
  const harnessCode = generateTestHarness(solutionPath, testCases, signature);

  await Bun.write(harnessPath, harnessCode);

  try {
    const proc = Bun.spawn(["bun", "run", harnessPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const state = { timedOut: false };
    const timeoutId = setTimeout(() => {
      state.timedOut = true;
      proc.kill();
    }, timeout);

    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // exitCode is non-zero when process was killed by timeout
    if (state.timedOut || (exitCode !== 0 && stdout.trim() === "")) {
      return {
        passed: 0,
        failed: testCases.length,
        total: testCases.length,
        results: testCases.map((tc) => ({
          passed: false,
          actual: "",
          expected: formatExpected(tc.expected),
          stderr: "Timed out",
          durationMs: timeout,
          timedOut: true,
        })),
        compileError: null,
      };
    }

    if (stdout.trim() === "") {
      return {
        passed: 0,
        failed: testCases.length,
        total: testCases.length,
        results: testCases.map((tc) => ({
          passed: false,
          actual: "",
          expected: formatExpected(tc.expected),
          stderr: stderr || "No output from test harness",
          durationMs: 0,
          timedOut: false,
        })),
        compileError: stderr || "Test harness produced no output",
      };
    }

    const harnessResults = harnessResultParser.parse(JSON.parse(stdout.trim()));

    let passed = 0;
    let failed = 0;
    const results: TestResult[] = [];

    for (const r of harnessResults) {
      if (r.passed) {
        passed++;
      } else {
        failed++;
      }
      results.push({
        passed: r.passed,
        actual: formatExpected(r.actual),
        expected: formatExpected(r.expected),
        stderr: r.error ?? "",
        durationMs: r.durationMs,
        timedOut: false,
      });
    }

    return { passed, failed, total: testCases.length, results, compileError: null };
  } finally {
    // Clean up harness file
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(harnessPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function formatExpected(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
