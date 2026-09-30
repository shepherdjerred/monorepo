import XMLBuilder from "fast-xml-builder";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import path from "node:path";
import { z } from "zod";

const XmlValueSchema = z.json();
const junitParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

// Gradle writes one JUnit file per test class under each project's
// build/test-results/<task>/ directory.
const gradleJUnitReportPattern = "**/build/test-results/**/TEST-*.xml";

// Lists the Gradle JUnit files under a workspace, skipping node_modules and
// nested workspaces (relative to workspaceDirectory) that report on their own.
export async function gradleJUnitReportPaths(
  workspaceDirectory: string,
  nestedWorkspaceDirectories: readonly string[],
): Promise<string[]> {
  const reportPaths: string[] = [];
  for await (const relativePath of new Bun.Glob(gradleJUnitReportPattern).scan({
    cwd: workspaceDirectory,
    onlyFiles: true,
  })) {
    const segments = relativePath.split(/[\\/]/);
    const normalized = segments.join("/");
    if (
      segments.includes("node_modules") ||
      nestedWorkspaceDirectories.some((directory) =>
        normalized.startsWith(`${directory}/`),
      )
    ) {
      continue;
    }
    reportPaths.push(path.join(workspaceDirectory, relativePath));
  }
  return reportPaths.sort();
}

function junitTestSuites(
  xml: string,
  source: string,
): Record<string, z.infer<typeof XmlValueSchema>>[] {
  let parsed: z.infer<typeof XmlValueSchema>;
  try {
    SyntaxValidator.validate(xml);
    parsed = XmlValueSchema.parse(junitParser.parse(xml));
  } catch (error) {
    throw new Error(`${source} is malformed JUnit XML`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source} has no JUnit root element`);
  }
  const container = "testsuites" in parsed ? parsed["testsuites"] : parsed;
  const suites =
    typeof container === "object" &&
    container !== null &&
    !Array.isArray(container)
      ? container["testsuite"]
      : undefined;
  if (suites === undefined) {
    throw new Error(`${source} contains no <testsuite> element`);
  }
  return (Array.isArray(suites) ? suites : [suites]).map((suite) => {
    if (typeof suite !== "object" || suite === null || Array.isArray(suite)) {
      throw new Error(`${source} contains an empty <testsuite> element`);
    }
    return suite;
  });
}

function numericSuiteAttribute(
  suite: Record<string, z.infer<typeof XmlValueSchema>>,
  attribute: "tests" | "failures" | "errors" | "skipped" | "time",
  source: string,
): number {
  const value = suite[`@_${attribute}`];
  if (value === undefined) {
    return 0;
  }
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${source} has a non-numeric ${attribute} attribute`);
  }
  return parsed;
}

// Combines per-class JUnit files into one <testsuites> document, keeping each
// <testsuite> (and its failures, errors, and skips) intact. A failed run whose
// reports record no failure gains an invocation failure, as Cargo's does.
export function mergeJUnitReports(
  reports: readonly { readonly source: string; readonly xml: string }[],
  runner: string,
  exitCode: number,
): string {
  if (reports.length === 0) {
    throw new Error("No JUnit reports to merge");
  }
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  const suites = reports.flatMap(({ source, xml }) => {
    const reportSuites = junitTestSuites(xml, source);
    for (const suite of reportSuites) {
      for (const attribute of [
        "tests",
        "failures",
        "errors",
        "skipped",
        "time",
      ] as const) {
        totals[attribute] += numericSuiteAttribute(suite, attribute, source);
      }
    }
    return reportSuites;
  });
  if (exitCode !== 0 && totals.failures + totals.errors === 0) {
    totals.tests += 1;
    totals.failures += 1;
    suites.push({
      "@_name": runner,
      "@_tests": "1",
      "@_failures": "1",
      testcase: {
        "@_classname": runner,
        "@_name": `${runner} invocation`,
        failure: {
          "@_message": `${runner} exited with status ${exitCode.toString()}`,
        },
      },
    });
  }
  return `${new XMLBuilder({
    ignoreAttributes: false,
    format: true,
  }).build({
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "utf8",
    },
    testsuites: {
      "@_tests": totals.tests.toString(),
      "@_failures": totals.failures.toString(),
      "@_errors": totals.errors.toString(),
      "@_skipped": totals.skipped.toString(),
      "@_time": totals.time.toFixed(3),
      testsuite: suites,
    },
  })}\n`;
}

// Merges a finished Gradle run's JUnit files into reportPath. A failed run
// with no files leaves reportPath absent so completeJUnitReport records the
// invocation failure; a successful run with no files is a reporting error.
export async function writeGradleJUnitReport({
  workspaceDirectory,
  nestedWorkspaceDirectories,
  reportPath,
  exitCode,
}: {
  workspaceDirectory: string;
  nestedWorkspaceDirectories: readonly string[];
  reportPath: string;
  exitCode: number;
}): Promise<void> {
  const reportPaths = await gradleJUnitReportPaths(
    workspaceDirectory,
    nestedWorkspaceDirectories,
  );
  if (reportPaths.length === 0) {
    if (exitCode === 0) {
      throw new Error(
        `gradle succeeded without writing JUnit reports matching ${gradleJUnitReportPattern} under ${workspaceDirectory}`,
      );
    }
    return;
  }
  const reports = await Promise.all(
    reportPaths.map(async (source) => ({
      source,
      xml: await Bun.file(source).text(),
    })),
  );
  await Bun.write(reportPath, mergeJUnitReports(reports, "gradle", exitCode));
}
