import { mkdir, mkdtemp, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  collectTestTimings,
  parseSuiteTimings,
  TestTimingsSchema,
} from "./test-timings.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

async function repository(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "ci-test-timings-"));
  directories.push(directory);
  return directory;
}

async function writeReport(root: string, report: string, xml: string) {
  const file = path.join(root, ".ci-reports/junit", report);
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, xml);
  return file;
}

/** The vitest/bun shape: a `testsuites` root with one `testsuite` per file. */
const vitestReport = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="12.5">
  <testsuite name="@test/media::src/fast.test.ts" timestamp="2026-11-08T01:02:03.000Z" hostname="ci" tests="2" failures="0" errors="0" skipped="0" time="0.25">
    <testcase classname="@test/media::src/fast.test.ts" name="works" time="0.1"/>
    <testcase classname="@test/media::src/fast.test.ts" name="also works" time="0.15"/>
  </testsuite>
  <testsuite name="@test/media::src/slow.integration.test.ts" timestamp="2026-11-08T01:02:03.000Z" hostname="ci" tests="1" failures="1" errors="0" skipped="0" time="12.25">
    <testcase classname="@test/media::src/slow.integration.test.ts" name="boots" time="12.25">
      <failure message="sentinel-failure-message">sentinel-stack TOKEN=sentinel-secret</failure>
      <system-out>sentinel-output</system-out>
    </testcase>
  </testsuite>
</testsuites>
`;

/** The Gradle shape: a bare `testsuite` root per class. */
const gradleReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="@test/storm::com.example.PlotTest" tests="4" skipped="0" failures="0" errors="0" timestamp="2026-11-08T01:02:03" hostname="ci" time="7.001">
  <properties/>
  <testcase name="reconciles" classname="@test/storm::com.example.PlotTest" time="7.001"/>
  <system-out><![CDATA[sentinel-gradle-output]]></system-out>
</testsuite>
`;

test("parses every testsuite summary and nothing from its test cases", () => {
  const suites = parseSuiteTimings("test__media/vitest.xml", vitestReport);
  expect(suites).toEqual([
    {
      report: "test__media/vitest.xml",
      name: "@test/media::src/fast.test.ts",
      seconds: 0.25,
      tests: 2,
      failures: 0,
    },
    {
      report: "test__media/vitest.xml",
      name: "@test/media::src/slow.integration.test.ts",
      seconds: 12.25,
      tests: 1,
      failures: 1,
    },
  ]);
  expect(JSON.stringify(suites)).not.toContain("sentinel");
});

test("accepts a bare testsuite root and nested suites", () => {
  expect(parseSuiteTimings("test__storm/jvm.xml", gradleReport)).toEqual([
    {
      report: "test__storm/jvm.xml",
      name: "@test/storm::com.example.PlotTest",
      seconds: 7.001,
      tests: 4,
      failures: 0,
    },
  ]);
  const nested = parseSuiteTimings(
    "nested/report.xml",
    '<testsuites><testsuite name="outer" tests="2" failures="0" time="3"><testsuite name="inner" tests="1" failures="0" time="1"/></testsuite></testsuites>',
  );
  expect(nested.map((suite) => suite.name)).toEqual(["outer", "inner"]);
});

test.each([
  {
    label: "an unparseable name",
    xml: '<testsuite name="bad&#10;name" tests="1" failures="0" time="1"/>',
  },
  {
    label: "a negative time",
    xml: '<testsuite name="ok" tests="1" failures="0" time="-1"/>',
  },
  {
    label: "a non-numeric count",
    xml: '<testsuite name="ok" tests="many" failures="0" time="1"/>',
  },
  {
    label: "a missing time",
    xml: '<testsuite name="ok" tests="1" failures="0"/>',
  },
  { label: "malformed XML", xml: "<testsuite name=" },
  { label: "no suites at all", xml: "<report/>" },
])("skips $label instead of failing", ({ xml }) => {
  const suites = parseSuiteTimings(
    "x/y.xml",
    `<testsuites>${xml}<testsuite name="kept" tests="1" failures="0" time="2"/></testsuites>`,
  );
  if (xml.startsWith('<testsuite name="')) {
    expect(suites.map((suite) => suite.name)).toEqual(["kept"]);
  } else {
    // Malformed documents and documents without suites yield nothing.
    expect(suites.length).toBeLessThanOrEqual(1);
  }
});

test("collects reports under .ci-reports/junit in path order", async () => {
  const root = await repository();
  await writeReport(root, "test__storm/jvm.xml", gradleReport);
  await writeReport(root, "test__media/vitest.xml", vitestReport);
  await writeReport(root, "test__media/notes.txt", "not a report");
  const timings = await collectTestTimings(root);
  expect(timings.version).toBe(1);
  expect(timings.suites.map((suite) => suite.report)).toEqual([
    "test__media/vitest.xml",
    "test__media/vitest.xml",
    "test__storm/jvm.xml",
  ]);
  expect(JSON.stringify(timings)).not.toContain("sentinel");
});

test("reports nothing when no step wrote a JUnit directory", async () => {
  expect(await collectTestTimings(await repository())).toEqual({
    version: 1,
    suites: [],
  });
});

test("skips malformed, oversized and oddly named reports", async () => {
  const root = await repository();
  await writeReport(root, "broken/report.xml", "<testsuite name=");
  const oversized = await writeReport(root, "huge/report.xml", "<x/>");
  await truncate(oversized, 20 * 1024 * 1024 + 1);
  await writeReport(root, "odd\u{1}name/report.xml", gradleReport);
  await writeReport(root, "fine/report.xml", gradleReport);
  const timings = await collectTestTimings(root);
  expect(timings.suites.map((suite) => suite.report)).toEqual([
    "fine/report.xml",
  ]);
});

test("bounds the collection at 20 000 suites", async () => {
  const root = await repository();
  const suites = Array.from(
    { length: 20_005 },
    (_, index) =>
      `<testsuite name="suite-${String(index)}" tests="1" failures="0" time="0.1"/>`,
  ).join("");
  await writeReport(
    root,
    "many/report.xml",
    `<testsuites>${suites}</testsuites>`,
  );
  await writeReport(root, "more/report.xml", gradleReport);
  const timings = await collectTestTimings(root);
  expect(timings.suites).toHaveLength(20_000);
  expect(timings.suites.at(-1)?.name).toBe("suite-19999");
});

test("the schema rejects oversized collections and malformed entries", () => {
  const suite = {
    report: "a/b.xml",
    name: "@test/a::src/a.test.ts",
    seconds: 1,
    tests: 1,
    failures: 0,
  };
  expect(
    TestTimingsSchema.parse({ version: 1, suites: [suite] }).suites,
  ).toEqual([suite]);
  expect(
    TestTimingsSchema.safeParse({
      version: 1,
      suites: Array.from({ length: 20_001 }, () => suite),
    }).success,
  ).toBe(false);
  for (const broken of [
    { ...suite, name: "x".repeat(301) },
    { ...suite, name: "bad\nname" },
    { ...suite, report: "../escape.xml" },
    { ...suite, report: "/abs/report.xml" },
    { ...suite, seconds: -1 },
    { ...suite, tests: 1.5 },
    { ...suite, failures: "0" },
  ]) {
    expect(
      TestTimingsSchema.safeParse({ version: 1, suites: [broken] }).success,
    ).toBe(false);
  }
});
