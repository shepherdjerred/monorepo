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

function javaArgDeserializer(tsType: string, jsonExpr: string): string {
  switch (tsType) {
    case "number":
      return `((Number) ${jsonExpr}).intValue()`;
    case "number[]":
      return `toIntArray((java.util.List<?>) ${jsonExpr})`;
    case "number[][]":
      return `toIntArray2D((java.util.List<?>) ${jsonExpr})`;
    case "string":
      return `(String) ${jsonExpr}`;
    case "string[]":
      return `toStringArray((java.util.List<?>) ${jsonExpr})`;
    case "boolean":
      return `(Boolean) ${jsonExpr}`;
    default:
      return `${jsonExpr}`;
  }
}

function javaResultSerializer(tsReturnType: string, expr: string): string {
  switch (tsReturnType) {
    case "number[]":
    case "number[][]":
    case "string[]":
    case "boolean[]":
      return `arrayToJson(${expr})`;
    default:
      return `String.valueOf(${expr})`;
  }
}

function generateJavaTestHarness(
  testCases: TestCase[],
  signature: FunctionSignature,
): string {
  const testCasesJson = JSON.stringify(
    testCases.map((tc) => ({ args: tc.args, expected: tc.expected })),
  );

  const argDeserializations = signature.params.map((p, i) =>
    `${tsTypeToJava(p.type)} arg${String(i)} = ${javaArgDeserializer(p.type, `args.get(${String(i)})`)};`
  ).join("\n            ");

  const argNames = signature.params.map((_, i) => `arg${String(i)}`).join(", ");
  const resultSer = javaResultSerializer(signature.returnType, "actual");

  return `import java.util.*;

public class TestRunner {
    public static void main(String[] args) throws Exception {
        String json = ${JSON.stringify(testCasesJson)};
        @SuppressWarnings("unchecked")
        java.util.List<Map<String, Object>> testCases =
            (java.util.List<Map<String, Object>>) new com.sun.script.javascript.RhinoScriptEngine()
            .eval("Java.from(" + json + ")");
        // Use simple JSON parsing instead
        testCases = parseTestCases(json);

        Solution solution = new Solution();
        StringBuilder sb = new StringBuilder("[");

        for (int i = 0; i < testCases.size(); i++) {
            Map<String, Object> tc = testCases.get(i);
            @SuppressWarnings("unchecked")
            java.util.List<Object> argsList = (java.util.List<Object>) tc.get("args");
            Object expectedRaw = tc.get("expected");
            long start = System.currentTimeMillis();

            try {
                ${argDeserializations}
                ${tsTypeToJava(signature.returnType)} actual = solution.${signature.name}(${argNames});
                String actualJson = ${resultSer};
                String expectedJson = toJson(expectedRaw);
                boolean passed = actualJson.equals(expectedJson);
                long duration = System.currentTimeMillis() - start;

                if (i > 0) sb.append(",");
                sb.append(String.format(
                    "{\\"passed\\":%b,\\"actual\\":%s,\\"expected\\":%s,\\"error\\":null,\\"durationMs\\":%d}",
                    passed, quoteJson(actualJson), quoteJson(expectedJson), duration));
            } catch (Exception e) {
                long duration = System.currentTimeMillis() - start;
                if (i > 0) sb.append(",");
                sb.append(String.format(
                    "{\\"passed\\":false,\\"actual\\":null,\\"expected\\":%s,\\"error\\":\\"%s\\",\\"durationMs\\":%d}",
                    quoteJson(toJson(expectedRaw)), escapeJson(e.getMessage()), duration));
            }
        }

        sb.append("]");
        System.out.println(sb.toString());
    }

    @SuppressWarnings("unchecked")
    static java.util.List<Map<String, Object>> parseTestCases(String json) throws Exception {
        // Minimal JSON array parser using Bun-compatible approach
        // We parse using a simple recursive descent or javax.script
        javax.script.ScriptEngine engine = new javax.script.ScriptEngineManager().getEngineByName("nashorn");
        if (engine == null) {
            engine = new javax.script.ScriptEngineManager().getEngineByName("js");
        }
        if (engine != null) {
            Object result = engine.eval("Java.from(JSON.parse(" + quoteForJs(json) + "))");
            return (java.util.List<Map<String, Object>>) result;
        }
        throw new RuntimeException("No JavaScript engine available for JSON parsing");
    }

    static String quoteForJs(String s) {
        return "\\"" + s.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"";
    }

    static int[] toIntArray(java.util.List<?> list) {
        int[] arr = new int[list.size()];
        for (int i = 0; i < list.size(); i++) arr[i] = ((Number) list.get(i)).intValue();
        return arr;
    }

    static int[][] toIntArray2D(java.util.List<?> list) {
        int[][] arr = new int[list.size()][];
        for (int i = 0; i < list.size(); i++) {
            @SuppressWarnings("unchecked")
            java.util.List<?> row = (java.util.List<?>) list.get(i);
            arr[i] = toIntArray(row);
        }
        return arr;
    }

    static String[] toStringArray(java.util.List<?> list) {
        String[] arr = new String[list.size()];
        for (int i = 0; i < list.size(); i++) arr[i] = (String) list.get(i);
        return arr;
    }

    static String toJson(Object o) {
        if (o == null) return "null";
        if (o instanceof Number) return String.valueOf(((Number) o).intValue());
        if (o instanceof Boolean) return String.valueOf(o);
        if (o instanceof String) return (String) o;
        if (o instanceof int[]) return Arrays.toString((int[]) o).replace(" ", "");
        if (o instanceof int[][]) {
            StringBuilder sb = new StringBuilder("[");
            int[][] arr = (int[][]) o;
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) sb.append(",");
                sb.append(Arrays.toString(arr[i]).replace(" ", ""));
            }
            sb.append("]");
            return sb.toString();
        }
        if (o instanceof String[]) {
            StringBuilder sb = new StringBuilder("[");
            String[] arr = (String[]) o;
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) sb.append(",");
                sb.append("\\"").append(arr[i]).append("\\"");
            }
            sb.append("]");
            return sb.toString();
        }
        if (o instanceof java.util.List) {
            @SuppressWarnings("unchecked")
            java.util.List<Object> list = (java.util.List<Object>) o;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(toJson(list.get(i)));
            }
            sb.append("]");
            return sb.toString();
        }
        return String.valueOf(o);
    }

    static String arrayToJson(Object arr) {
        return toJson(arr);
    }

    static String quoteJson(String s) {
        if (s.startsWith("[") || s.startsWith("{") || s.equals("null") ||
            s.equals("true") || s.equals("false") ||
            s.matches("-?\\\\d+(\\\\.\\\\d+)?")) {
            return s;
        }
        return "\\"" + escapeJson(s) + "\\"";
    }

    static String escapeJson(String s) {
        if (s == null) return "null";
        return s.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"").replace("\\n", "\\\\n");
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
