import { dirname, basename } from "node:path";
import { getLanguageConfig } from "./languages.ts";
import type { TestCase } from "#lib/questions/schemas.ts";

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

function interpolateCmd(
  template: string,
  filePath: string,
): string {
  const dir = dirname(filePath);
  const file = filePath;
  return template.replaceAll('{file}', file).replaceAll('{dir}', dir);
}

async function compileFile(
  compileCmd: string,
  filePath: string,
  timeout: number,
): Promise<string | null> {
  const cmd = interpolateCmd(compileCmd, filePath);
  const parts = cmd.split(" ");
  const proc = Bun.spawn(parts, {
    cwd: dirname(filePath),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutId = setTimeout(() => { proc.kill(); }, timeout);
  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return stderr || `Compilation failed with exit code ${exitCode}`;
  }
  return null;
}

async function runWithInput(
  runCmd: string,
  filePath: string,
  input: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string; timedOut: boolean; durationMs: number }> {
  const cmd = interpolateCmd(runCmd, filePath);
  const parts = cmd.split(" ");
  const start = Date.now();

  const proc = Bun.spawn(parts, {
    cwd: dirname(filePath),
    stdin: new Response(input).body,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  await proc.exited;
  clearTimeout(timeoutId);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const durationMs = Date.now() - start;

  return { stdout, stderr, timedOut, durationMs };
}

export async function runTests(
  solutionPath: string,
  testCases: TestCase[],
): Promise<TestRunResult> {
  const ext = "." + basename(solutionPath).split(".").pop();
  const langConfig = getLanguageConfig(ext);

  if (!langConfig) {
    return {
      passed: 0,
      failed: testCases.length,
      total: testCases.length,
      results: testCases.map((tc) => ({
        passed: false,
        actual: "",
        expected: tc.expected,
        stderr: `Unsupported language: ${ext}`,
        durationMs: 0,
        timedOut: false,
      })),
      compileError: `Unsupported language extension: ${ext}`,
    };
  }

  if (langConfig.compile) {
    const compileError = await compileFile(
      langConfig.compile,
      solutionPath,
      langConfig.compileTimeout,
    );
    if (compileError) {
      return {
        passed: 0,
        failed: testCases.length,
        total: testCases.length,
        results: testCases.map((tc) => ({
          passed: false,
          actual: "",
          expected: tc.expected,
          stderr: compileError,
          durationMs: 0,
          timedOut: false,
        })),
        compileError,
      };
    }
  }

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const { stdout, stderr, timedOut, durationMs } = await runWithInput(
      langConfig.run,
      solutionPath,
      tc.input,
      langConfig.runTimeout,
    );

    const actualTrimmed = stdout.trim();
    const expectedTrimmed = tc.expected.trim();
    const isPassed = !timedOut && actualTrimmed === expectedTrimmed;

    if (isPassed) {
      passed++;
    } else {
      failed++;
    }

    results.push({
      passed: isPassed,
      actual: actualTrimmed,
      expected: expectedTrimmed,
      stderr,
      durationMs,
      timedOut,
    });
  }

  return { passed, failed, total: testCases.length, results, compileError: null };
}
