import { describe, expect, test } from "vitest";
import path from "node:path";
import { namespaceJUnit, TestManifestSchema } from "./ci-reporting.ts";
import {
  gradleJUnitReportPaths,
  mergeJUnitReports,
  writeGradleJUnitReport,
} from "./gradle-junit.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
const gradlePassingSuite = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<testsuite name="red.sjer.storm.MapTest" tests="2" skipped="1" failures="0" errors="0" timestamp="2026-09-24T00:00:00" hostname="ci" time="0.25">',
  "<properties/>",
  '<testcase name="loads()" classname="red.sjer.storm.MapTest" time="0.2"/>',
  '<testcase name="renders()" classname="red.sjer.storm.MapTest" time="0.0"><skipped/></testcase>',
  "<system-out><![CDATA[a < b && c]]></system-out>",
  "<system-err><![CDATA[]]></system-err>",
  "</testsuite>",
].join("\n");
const gradleFailingSuite = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<testsuite name="red.sjer.storm.UnitTest" tests="1" skipped="0" failures="1" errors="0" time="0.5">',
  '<testcase name="moves()" classname="red.sjer.storm.UnitTest" time="0.5">',
  '<failure message="expected: 1 but was: 2" type="org.opentest4j.AssertionFailedError">stack</failure>',
  "</testcase>",
  "</testsuite>",
].join("\n");

function manifestWithStep(step: Record<string, unknown>) {
  return {
    $schema: "./ci-test-manifest.schema.json",
    version: 2,
    workspaces: [
      { package: "java", directory: "packages/java", steps: [step] },
    ],
    testlessWorkspaces: [],
    separateTests: [],
  };
}

describe("Gradle JUnit reporting", () => {
  test("accepts a Gradle step only with arguments", () => {
    expect(
      TestManifestSchema.safeParse(
        manifestWithStep({ runner: "gradle", args: ["test"] }),
      ).success,
    ).toBe(true);
    expect(
      TestManifestSchema.safeParse(
        manifestWithStep({ runner: "gradle", args: [] }),
      ).success,
    ).toBe(false);
    expect(
      TestManifestSchema.safeParse(
        manifestWithStep({
          runner: "gradle",
          args: ["test"],
          coverageConfig: "x",
        }),
      ).success,
    ).toBe(false);
  });

  test("merges per-class reports and preserves failures and skips", () => {
    const merged = mergeJUnitReports(
      [
        { source: "a.xml", xml: gradlePassingSuite },
        { source: "b.xml", xml: gradleFailingSuite },
      ],
      "gradle",
      1,
    );
    expect(merged).toMatch(
      /<testsuites tests="3" failures="1" errors="0" skipped="1" time="0\.750">/,
    );
    expect(merged).not.toContain("gradle invocation");
    const namespaced = namespaceJUnit(merged, "@scope/java");
    expect(namespaced).toContain('name="@scope/java::red.sjer.storm.MapTest"');
    expect(namespaced).toContain(
      'classname="@scope/java::red.sjer.storm.UnitTest"',
    );
    expect(namespaced).toContain("<skipped");
    expect(namespaced).toContain('message="expected: 1 but was: 2"');
    expect(namespaced).toContain("a &lt; b &amp;&amp; c");
  });

  test("records an invocation failure when no suite failed", () => {
    const merged = mergeJUnitReports(
      [{ source: "a.xml", xml: gradlePassingSuite }],
      "gradle",
      1,
    );
    expect(merged).toMatch(/<testsuites tests="3" failures="1"/);
    expect(merged).toContain('name="gradle invocation"');
    expect(merged).toContain('message="gradle exited with status 1"');
  });

  test("rejects reports without suites or with malformed XML", () => {
    expect(() => mergeJUnitReports([], "gradle", 0)).toThrow(
      "No JUnit reports",
    );
    expect(() =>
      mergeJUnitReports([{ source: "a.xml", xml: "<testsuite" }], "gradle", 0),
    ).toThrow("a.xml is malformed JUnit XML");
    expect(() =>
      mergeJUnitReports(
        [{ source: "a.xml", xml: "<testsuites></testsuites>" }],
        "gradle",
        0,
      ),
    ).toThrow("a.xml contains no <testsuite> element");
  });

  test("collects only this workspace's reports", async () => {
    const workspaceDirectory = path.join(
      repositoryRoot,
      ".ci-reports",
      `gradle-${process.pid.toString()}`,
    );
    const reportPath = path.join(workspaceDirectory, "merged.xml");
    try {
      for (const reportFile of [
        "core/build/test-results/test/TEST-red.sjer.storm.MapTest.xml",
        "build/test-results/test/TEST-red.sjer.storm.UnitTest.xml",
        "node_modules/dep/build/test-results/test/TEST-Dep.xml",
        "nested/build/test-results/test/TEST-Nested.xml",
      ]) {
        await Bun.write(
          path.join(workspaceDirectory, reportFile),
          gradlePassingSuite,
        );
      }
      await Bun.write(
        path.join(
          workspaceDirectory,
          "build/test-results/test/binary/results.bin",
        ),
        "",
      );

      const reportPaths = await gradleJUnitReportPaths(workspaceDirectory, [
        "nested",
      ]);
      expect(
        reportPaths.map((reportFile) =>
          path.relative(workspaceDirectory, reportFile),
        ),
      ).toEqual([
        "build/test-results/test/TEST-red.sjer.storm.UnitTest.xml",
        "core/build/test-results/test/TEST-red.sjer.storm.MapTest.xml",
      ]);

      await writeGradleJUnitReport({
        workspaceDirectory,
        nestedWorkspaceDirectories: ["nested"],
        reportPath,
        exitCode: 0,
      });
      expect(await Bun.file(reportPath).text()).toMatch(
        /<testsuites tests="4" failures="0" errors="0" skipped="2"/,
      );
    } finally {
      await Bun.$`rm -rf ${workspaceDirectory}`;
    }
  });

  test("requires reports only from a successful run", async () => {
    const workspaceDirectory = path.join(
      repositoryRoot,
      ".ci-reports",
      `gradle-empty-${process.pid.toString()}`,
    );
    const reportPath = path.join(workspaceDirectory, "merged.xml");
    try {
      await Bun.$`mkdir -p ${workspaceDirectory}`;
      await expect(
        writeGradleJUnitReport({
          workspaceDirectory,
          nestedWorkspaceDirectories: [],
          reportPath,
          exitCode: 0,
        }),
      ).rejects.toThrow("gradle succeeded without writing JUnit reports");
      await writeGradleJUnitReport({
        workspaceDirectory,
        nestedWorkspaceDirectories: [],
        reportPath,
        exitCode: 1,
      });
      expect(await Bun.file(reportPath).exists()).toBe(false);
    } finally {
      await Bun.$`rm -rf ${workspaceDirectory}`;
    }
  });
});
