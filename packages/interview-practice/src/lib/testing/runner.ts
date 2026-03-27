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

  // For Java with a function signature, use the Java test harness
  if (ext === ".java" && signature !== undefined) {
    return runWithJavaHarness(solutionPath, testCases, signature, langConfig);
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

// --- Java test harness ---

function tsTypeToJava(tsType: string): string {
  const map: Record<string, string> = {
    "number": "int",
    "number[]": "int[]",
    "number[][]": "int[][]",
    "string": "String",
    "string[]": "String[]",
    "boolean": "boolean",
    "boolean[]": "boolean[]",
  };
  return map[tsType] ?? tsType;
}

function javaLiteral(value: unknown, tsType: string): string {
  if (value === null || value === undefined) return "null";
  switch (tsType) {
    case "number":
      return String(value);
    case "number[]":
      return `new int[]{${(value as number[]).join(", ")}}`;
    case "number[][]":
      return `new int[][]{${(value as number[][]).map((row) => `{${row.join(", ")}}`).join(", ")}}`;
    case "string":
      return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "string[]":
      return `new String[]{${(value as string[]).map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(", ")}}`;
    case "boolean":
      return String(value);
    case "boolean[]":
      return `new boolean[]{${(value as boolean[]).join(", ")}}`;
    default:
      return String(value);
  }
}

function javaDeepEquals(tsType: string, actual: string, expected: string): string {
  if (tsType.includes("[]")) {
    return `java.util.Arrays.deepEquals(box(${actual}), box(${expected}))`;
  }
  return `java.util.Objects.equals(${actual}, ${expected})`;
}

function javaToJsonString(tsType: string, expr: string): string {
  if (tsType.includes("[][]")) return `deepToString(${expr})`;
  if (tsType.includes("[]")) return `java.util.Arrays.toString(${expr}).replace(" ", "")`;
  if (tsType === "string") return `"\\"" + ${expr} + "\\""`;
  return `String.valueOf(${expr})`;
}

function generateJavaTestHarness(
  testCases: TestCase[],
  signature: FunctionSignature,
): string {
  const cases: string[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (tc === undefined) continue;
    const args = signature.params.map((p, j) => {
      const arg = (tc.args as unknown[])[j];
      return javaLiteral(arg, p.type);
    });
    const expectedLiteral = javaLiteral(tc.expected, signature.returnType);
    const expectedJson = javaToJsonString(signature.returnType, `expected${String(i)}`);
    const actualJson = javaToJsonString(signature.returnType, `actual${String(i)}`);
    const equals = javaDeepEquals(signature.returnType, `actual${String(i)}`, `expected${String(i)}`);

    cases.push(`
            // Test case ${String(i + 1)}
            {
                ${tsTypeToJava(signature.returnType)} expected${String(i)} = ${expectedLiteral};
                long start = System.currentTimeMillis();
                try {
                    ${tsTypeToJava(signature.returnType)} actual${String(i)} = sol.${signature.name}(${args.join(", ")});
                    boolean passed = ${equals};
                    long dur = System.currentTimeMillis() - start;
                    if (idx > 0) sb.append(",");
                    sb.append(String.format("{\\"passed\\":%b,\\"actual\\":%s,\\"expected\\":%s,\\"error\\":null,\\"durationMs\\":%d}",
                        passed, ${actualJson}, ${expectedJson}, dur));
                } catch (Exception e) {
                    long dur = System.currentTimeMillis() - start;
                    if (idx > 0) sb.append(",");
                    sb.append(String.format("{\\"passed\\":false,\\"actual\\":null,\\"expected\\":%s,\\"error\\":\\"%s\\",\\"durationMs\\":%d}",
                        ${expectedJson}, e.getMessage() != null ? e.getMessage().replace("\\"", "\\\\\\"") : "null", dur));
                }
                idx++;
            }`);
  }

  return `import java.util.*;

public class TestRunner {
    public static void main(String[] args) {
        Solution sol = new Solution();
        StringBuilder sb = new StringBuilder("[");
        int idx = 0;
${cases.join("\n")}
        sb.append("]");
        System.out.println(sb.toString());
    }

    static Object[] box(int[] a) { Integer[] b = new Integer[a.length]; for (int i=0;i<a.length;i++) b[i]=a[i]; return b; }
    static Object[] box(int[][] a) { Object[] b = new Object[a.length]; for (int i=0;i<a.length;i++) { Integer[] r=new Integer[a[i].length]; for(int j=0;j<a[i].length;j++) r[j]=a[i][j]; b[i]=r; } return b; }
    static Object[] box(String[] a) { return a; }
    static Object[] box(boolean[] a) { Boolean[] b = new Boolean[a.length]; for (int i=0;i<a.length;i++) b[i]=a[i]; return b; }
    static Object[] box(Object[] a) { return a; }

    static String deepToString(int[][] a) {
        StringBuilder s = new StringBuilder("[");
        for (int i=0;i<a.length;i++) { if(i>0)s.append(","); s.append(Arrays.toString(a[i]).replace(" ","")); }
        s.append("]"); return s.toString();
    }
}
`;
}

import type { LanguageConfig } from "./languages.ts";

async function runWithJavaHarness(
  solutionPath: string,
  testCases: TestCase[],
  signature: FunctionSignature,
  langConfig: LanguageConfig,
): Promise<TestRunResult> {
  const dir = path.dirname(solutionPath);
  const harnessPath = path.join(dir, "TestRunner.java");
  const harnessCode = generateJavaTestHarness(testCases, signature);

  await Bun.write(harnessPath, harnessCode);

  try {
    // Compile both Solution.java and TestRunner.java
    const compileProc = Bun.spawn(
      ["javac", path.basename(solutionPath), "TestRunner.java"],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );

    const compileState = { timedOut: false };
    const compileTimeoutId = setTimeout(() => {
      compileState.timedOut = true;
      compileProc.kill();
    }, langConfig.compileTimeout);

    const compileExit = await compileProc.exited;
    clearTimeout(compileTimeoutId);

    const compileStderr = await new Response(compileProc.stderr).text();

    if (compileState.timedOut || compileExit !== 0) {
      return {
        passed: 0,
        failed: testCases.length,
        total: testCases.length,
        results: testCases.map((tc) => ({
          passed: false,
          actual: "",
          expected: formatExpected(tc.expected),
          stderr: compileState.timedOut ? "Compilation timed out" : compileStderr,
          durationMs: 0,
          timedOut: compileState.timedOut,
        })),
        compileError: compileState.timedOut ? "Compilation timed out" : compileStderr,
      };
    }

    // Run TestRunner
    const runProc = Bun.spawn(
      ["java", "-cp", dir, "TestRunner"],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );

    const runState = { timedOut: false };
    const runTimeoutId = setTimeout(() => {
      runState.timedOut = true;
      runProc.kill();
    }, langConfig.runTimeout);

    const runExit = await runProc.exited;
    clearTimeout(runTimeoutId);

    const stdout = await new Response(runProc.stdout).text();
    const stderr = await new Response(runProc.stderr).text();

    if (runState.timedOut || (runExit !== 0 && stdout.trim() === "")) {
      return {
        passed: 0,
        failed: testCases.length,
        total: testCases.length,
        results: testCases.map((tc) => ({
          passed: false,
          actual: "",
          expected: formatExpected(tc.expected),
          stderr: runState.timedOut ? "Timed out" : (stderr || "Runtime error"),
          durationMs: runState.timedOut ? langConfig.runTimeout : 0,
          timedOut: runState.timedOut,
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
      if (r.passed) passed++;
      else failed++;
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
    // Clean up generated files
    try {
      const { unlinkSync } = await import("node:fs");
      const cleanupFiles = ["TestRunner.java", "TestRunner.class", "Solution.class"];
      for (const f of cleanupFiles) {
        try { unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    } catch { /* ignore cleanup errors */ }
  }
}

function formatExpected(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
