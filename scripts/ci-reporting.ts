import XMLBuilder from "fast-xml-builder";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import { z } from "zod";

const StepSchema = z.discriminatedUnion("runner", [
  z
    .object({
      runner: z.literal("bun"),
      name: z.string().min(1).optional(),
      bunArgs: z.array(z.string()).optional(),
      args: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      runner: z.literal("vitest"),
      name: z.string().min(1).optional(),
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      runner: z.literal("go"),
      name: z.string().min(1).optional(),
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      runner: z.literal("cargo"),
      name: z.string().min(1).optional(),
      args: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      runner: z.literal("command"),
      name: z.string().min(1),
      command: z.array(z.string()).min(1),
    })
    .strict(),
]);

export const TestManifestSchema = z
  .object({
    $schema: z.literal("./ci-test-manifest.schema.json"),
    version: z.literal(1),
    workspaces: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          defaultEnv: z.record(z.string(), z.string()).optional(),
          steps: z.array(StepSchema).min(1),
        })
        .strict(),
    ),
    testlessWorkspaces: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    separateTests: z.array(
      z
        .object({
          package: z.string().min(1),
          directory: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type TestManifest = z.infer<typeof TestManifestSchema>;
export type TestStep = z.infer<typeof StepSchema>;

type CompleteJUnitReportOptions = {
  runner: TestStep["runner"];
  reportPath: string;
  workspace: string;
  name: string;
  durationSeconds: number;
  exitCode: number;
};

type CompletedJUnitReport = {
  exitCode: number;
  reportingError?: Error;
};

export function sanitizeWorkspace(value: string): string {
  return value.replaceAll("@", "").replaceAll("/", "__");
}

export function applyDefaultEnvironment(
  environment: Record<string, string | undefined>,
  defaults: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(defaults)) {
    if (environment[name] === undefined || environment[name] === "") {
      environment[name] = value;
    }
  }
}

export function reportedWorkspacesForReports(
  manifest: TestManifest,
  reports: readonly string[],
): string[] {
  const packagesByReportDirectory = new Map(
    [...manifest.workspaces, ...manifest.separateTests].map((entry) => [
      sanitizeWorkspace(entry.package),
      entry.package,
    ]),
  );
  const reported = new Set<string>();
  for (const report of reports) {
    const reportDirectory = report.split(/[\\/]/)[0];
    const workspace =
      reportDirectory === undefined
        ? undefined
        : packagesByReportDirectory.get(reportDirectory);
    if (workspace === undefined) {
      throw new Error(
        `JUnit report belongs to an unknown workspace: ${report}`,
      );
    }
    reported.add(workspace);
  }
  return [...reported].sort();
}

const XmlValueSchema = z.json();
const junitParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

function prefixElementAttribute(
  value: z.infer<typeof XmlValueSchema>,
  element: "testsuite" | "testcase",
  attribute: "name" | "classname",
  prefix: string,
): number {
  if (Array.isArray(value)) {
    let count = 0;
    for (const child of value) {
      count += prefixElementAttribute(child, element, attribute, prefix);
    }
    return count;
  }
  if (typeof value !== "object" || value === null) {
    return 0;
  }

  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === element) {
      const elements = Array.isArray(child) ? child : [child];
      count += elements.length;
      for (const node of elements) {
        if (typeof node !== "object" || node === null || Array.isArray(node)) {
          continue;
        }
        const attributeName = `@_${attribute}`;
        const current = node[attributeName];
        if (typeof current === "string") {
          node[attributeName] = `${prefix}${current}`;
        }
      }
    }
    count += prefixElementAttribute(child, element, attribute, prefix);
  }
  return count;
}

export function namespaceJUnit(xml: string, workspace: string): string {
  if (xml.trim().length === 0) {
    throw new Error(`${workspace} emitted an empty JUnit report`);
  }
  let parsed: z.infer<typeof XmlValueSchema>;
  try {
    const validation = SyntaxValidator.validate(xml);
    if (validation !== true) {
      throw new Error(validation.err.msg);
    }
    parsed = XmlValueSchema.parse(junitParser.parse(xml));
  } catch (error) {
    throw new Error(`${workspace} emitted malformed JUnit XML`, {
      cause: error,
    });
  }
  const prefix = `${workspace}::`;
  prefixElementAttribute(parsed, "testsuite", "name", prefix);
  const testCases = prefixElementAttribute(
    parsed,
    "testcase",
    "classname",
    prefix,
  );
  if (testCases === 0) {
    throw new Error(`${workspace} emitted a JUnit report with no test cases`);
  }
  return `${new XMLBuilder({ ignoreAttributes: false }).build(parsed)}\n`;
}

export function syntheticJUnit(
  workspace: string,
  name: string,
  durationSeconds: number,
  exitCode: number,
): string {
  const failures = exitCode === 0 ? "0" : "1";
  const testcase = {
    "@_classname": `${workspace}::command`,
    "@_name": name,
    "@_time": durationSeconds.toFixed(3),
    ...(exitCode === 0
      ? {}
      : {
          failure: {
            "@_message": `command exited with status ${exitCode.toString()}`,
          },
        }),
  };
  return `${new XMLBuilder({
    ignoreAttributes: false,
    format: true,
  }).build({
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "utf8",
    },
    testsuites: {
      "@_name": workspace,
      "@_tests": "1",
      "@_failures": failures,
      testsuite: {
        "@_name": `${workspace}::${name}`,
        "@_tests": "1",
        "@_failures": failures,
        "@_time": durationSeconds.toFixed(3),
        testcase,
      },
    },
  })}\n`;
}

export function cargoTestJUnit(
  output: { readonly stdout: string; readonly stderr: string },
  name: string,
  durationSeconds: number,
  exitCode: number,
): string {
  const testCases = [output.stdout, output.stderr]
    .join("\n")
    .split("\n")
    .flatMap((line) => {
      const match = /^test (.+) \.\.\. (ok|FAILED|ignored(?:, .*)?)$/.exec(
        line.trim(),
      );
      if (match?.[1] === undefined || match[2] === undefined) {
        return [];
      }
      return [{ name: match[1], status: match[2] }];
    });
  if (exitCode === 0 && testCases.length === 0) {
    throw new Error("cargo test succeeded without reporting any test cases");
  }
  const hasReportedFailure = testCases.some(
    ({ status }) => status === "FAILED",
  );
  const invocationFailure =
    exitCode !== 0 && !hasReportedFailure
      ? [{ name: "cargo invocation", status: "FAILED" }]
      : [];
  const cases = [...testCases, ...invocationFailure];
  const failures = cases.filter(({ status }) => status === "FAILED").length;
  const skipped = cases.filter(({ status }) =>
    status.startsWith("ignored"),
  ).length;
  return `${new XMLBuilder({
    ignoreAttributes: false,
    format: true,
  }).build({
    testsuite: {
      "@_name": name,
      "@_tests": cases.length.toString(),
      "@_failures": failures.toString(),
      "@_skipped": skipped.toString(),
      "@_time": durationSeconds.toFixed(3),
      testcase: cases.map(({ name: testName, status }) => ({
        "@_classname": "cargo",
        "@_name": testName,
        ...(status === "FAILED"
          ? {
              failure: {
                "@_message": `cargo test exited with status ${exitCode.toString()}`,
              },
            }
          : {}),
        ...(status.startsWith("ignored") ? { skipped: {} } : {}),
      })),
    },
  })}\n`;
}

export async function removeExistingReport(reportPath: string): Promise<void> {
  const report = Bun.file(reportPath);
  if (await report.exists()) {
    await report.delete();
  }
}

export async function completeJUnitReport({
  runner,
  reportPath,
  workspace,
  name,
  durationSeconds,
  exitCode,
}: CompleteJUnitReportOptions): Promise<CompletedJUnitReport> {
  try {
    if (runner === "command") {
      await Bun.write(
        reportPath,
        syntheticJUnit(workspace, name, durationSeconds, exitCode),
      );
    } else {
      const xml = await Bun.file(reportPath).text();
      await Bun.write(reportPath, namespaceJUnit(xml, workspace));
    }
    return { exitCode };
  } catch (error) {
    const reportingError =
      error instanceof Error ? error : new Error(String(error));
    return { exitCode, reportingError };
  }
}
