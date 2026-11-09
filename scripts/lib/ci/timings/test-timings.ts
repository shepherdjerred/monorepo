import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

/**
 * Per-suite wall time from the JUnit reports a CI test step leaves under
 * `.ci-reports/junit/<workspace>/<step>.xml`, so a slow `test:ci` task can be
 * explained by the files inside it rather than guessed at. Only the
 * `<testsuite>` summary attributes are kept: no test-case bodies, failure
 * messages or captured output, which can echo environment values. Reports
 * exist only for test tasks that executed (`test:ci` declares no Turbo
 * outputs, so a cache hit restores none), and a malformed report or suite is
 * skipped rather than failing the collection.
 */
const MAX_SUITES = 20_000;
const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const JUNIT_ROOT = path.join(".ci-reports", "junit");

/** Like task-diagnostics' Name, plus the spaces, brackets and signs suite names carry. */
const SuiteName = z
  .string()
  .regex(/^[\w@./:#()[\],+ -]+$/u)
  .max(300);
const ReportPath = z
  .string()
  .regex(/^[\w@./:#+ -]+\.xml$/u)
  .max(300)
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !value.split("/").some((segment) => segment === ".." || segment === ""),
  );
const Count = z.number().int().nonnegative();

export const TestSuiteTimingSchema = z.object({
  /** Path under `.ci-reports/junit`: `<workspace-dir>/<step>.xml`. */
  report: ReportPath,
  /** The `testsuite` name, already `<workspace>::`-prefixed by the step. */
  name: SuiteName,
  seconds: z.number().nonnegative(),
  tests: Count,
  failures: Count,
});
export type TestSuiteTiming = z.infer<typeof TestSuiteTimingSchema>;

export const TestTimingsSchema = z.object({
  version: z.literal(1),
  suites: z.array(TestSuiteTimingSchema).max(MAX_SUITES),
});
export type TestTimings = z.infer<typeof TestTimingsSchema>;

const XmlValue = z.json();
type XmlValue = z.infer<typeof XmlValue>;
const SuiteAttributes = z
  .object({
    "@_name": z.string(),
    "@_time": z.coerce.number(),
    "@_tests": z.coerce.number(),
    "@_failures": z.coerce.number(),
  })
  .loose();

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

/**
 * Every `<testsuite>` reachable through `<testsuites>` or another
 * `<testsuite>`, in document order. Test cases are never descended into.
 */
function suiteElements(value: XmlValue, into: XmlValue[]): void {
  if (Array.isArray(value)) {
    for (const child of value) suiteElements(child, into);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "testsuite") {
      for (const element of Array.isArray(child) ? child : [child]) {
        into.push(element);
        suiteElements(element, into);
      }
    } else if (key === "testsuites") {
      suiteElements(child, into);
    }
  }
}

export function parseSuiteTimings(
  report: string,
  xml: string,
): TestSuiteTiming[] {
  let parsed: XmlValue;
  try {
    parsed = XmlValue.parse(parser.parse(xml));
  } catch {
    return [];
  }
  const elements: XmlValue[] = [];
  suiteElements(parsed, elements);
  return elements.flatMap((element) => {
    const attributes = SuiteAttributes.safeParse(element);
    if (!attributes.success) return [];
    const suite = TestSuiteTimingSchema.safeParse({
      report,
      name: attributes.data["@_name"],
      seconds: attributes.data["@_time"],
      tests: attributes.data["@_tests"],
      failures: attributes.data["@_failures"],
    });
    return suite.success ? [suite.data] : [];
  });
}

/** Report paths under the JUnit root, sorted; none when no test step wrote one. */
async function reportFiles(junitRoot: string): Promise<string[]> {
  const reports: string[] = [];
  try {
    for await (const report of new Bun.Glob("**/*.xml").scan({
      cwd: junitRoot,
      onlyFiles: true,
    })) {
      reports.push(report);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  return reports.sort();
}

export async function collectTestTimings(root: string): Promise<TestTimings> {
  const junitRoot = path.join(root, JUNIT_ROOT);
  const suites: TestSuiteTiming[] = [];
  for (const report of await reportFiles(junitRoot)) {
    if (suites.length >= MAX_SUITES) break;
    if (!ReportPath.safeParse(report).success) continue;
    const file = Bun.file(path.join(junitRoot, report));
    if (file.size > MAX_REPORT_BYTES) continue;
    let xml: string;
    try {
      xml = await file.text();
    } catch {
      continue;
    }
    suites.push(
      ...parseSuiteTimings(report, xml).slice(0, MAX_SUITES - suites.length),
    );
  }
  return TestTimingsSchema.parse({ version: 1, suites });
}
