import { describe, expect, test } from "bun:test";
import path from "node:path";
import { z } from "zod";
import {
  applyDefaultEnvironment,
  assertExcludedSuitesAreUncovered,
  cargoTestJUnit,
  completeJUnitReport,
  namespaceJUnit,
  removeExistingReport,
  reportedWorkspacesForReports,
  sanitizeWorkspace,
  syntheticJUnit,
  TestManifestSchema,
} from "./ci-reporting.ts";
import { sumCoverageMetrics } from "./coverage-metrics.ts";
import {
  coveragePercentage,
  parseGoCover,
  parseLcov,
  summarizeCoverageReports,
} from "./coverage-reporting.ts";
import {
  coverableWorkspaceSources,
  initialSourceCoverage,
  resolveCoverageSource,
  sourceCoverageSupplement,
  uncoveredWorkspaceSources,
} from "./coverage-source-inventory.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const RootPackageSchema = z.object({ workspaces: z.array(z.string()) });
const WorkspacePackageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
});

describe("CI reporting boundaries", () => {
  test("applies defaults to unset and empty environment values", () => {
    const environment: Record<string, string | undefined> = {
      EMPTY: "",
      EXISTING: "configured",
    };
    applyDefaultEnvironment(environment, {
      EMPTY: "empty-default",
      EXISTING: "existing-default",
      UNSET: "unset-default",
    });
    expect(environment).toEqual({
      EMPTY: "empty-default",
      EXISTING: "configured",
      UNSET: "unset-default",
    });
  });

  test("rejects unknown properties at every manifest object boundary", () => {
    const validManifest = {
      $schema: "./ci-test-manifest.schema.json",
      version: 1,
      workspaces: [
        {
          package: "package",
          directory: "packages/package",
          steps: [{ runner: "bun" }],
        },
      ],
      testlessWorkspaces: [
        {
          package: "no-tests",
          directory: "packages/no-tests",
          reason: "No tests exist.",
        },
      ],
      separateTests: [
        {
          package: "separate-tests",
          directory: "packages/separate-tests",
          reason: "Tests run in a separate lane.",
        },
      ],
    };

    expect(
      TestManifestSchema.safeParse({ ...validManifest, typo: true }).success,
    ).toBeFalse();
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        workspaces: [{ ...validManifest.workspaces[0], defaultENV: {} }],
      }).success,
    ).toBeFalse();
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        workspaces: [
          {
            ...validManifest.workspaces[0],
            steps: [{ runner: "bun", arg: "test.ts" }],
          },
        ],
      }).success,
    ).toBeFalse();
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        testlessWorkspaces: [
          { ...validManifest.testlessWorkspaces[0], typo: true },
        ],
      }).success,
    ).toBeFalse();
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        separateTests: [{ ...validManifest.separateTests[0], typo: true }],
      }).success,
    ).toBeFalse();
  });

  test("committed manifest never runs a suite it documents as excluded", async () => {
    const manifest = TestManifestSchema.parse(
      await Bun.file(
        path.join(repositoryRoot, "scripts", "ci-test-manifest.json"),
      ).json(),
    );
    expect(() => {
      assertExcludedSuitesAreUncovered(manifest);
    }).not.toThrow();

    for (const workspace of manifest.workspaces) {
      for (const excluded of workspace.excludedSuites ?? []) {
        const suitePath = path.join(
          repositoryRoot,
          workspace.directory,
          excluded.path,
        );
        // A documented exclusion must reference a real suite file so it cannot
        // rot into a stale claim once the underlying test is renamed or removed.
        expect(await Bun.file(suitePath).exists()).toBeTrue();
      }
    }
  });

  test("rejects an excluded suite that a reporting step still runs", () => {
    const manifest = TestManifestSchema.parse({
      $schema: "./ci-test-manifest.schema.json",
      version: 1,
      workspaces: [
        {
          package: "package",
          directory: "packages/package",
          steps: [{ runner: "bun", args: ["src", "contract-tests"] }],
          excludedSuites: [
            { path: "contract-tests", reason: "runs in a dedicated lane" },
          ],
        },
      ],
      testlessWorkspaces: [],
      separateTests: [],
    });
    expect(() => {
      assertExcludedSuitesAreUncovered(manifest);
    }).toThrow(/excluded suite but a reporting step already runs it/);
  });
});

describe("CI test reporting", () => {
  test("creates filesystem-safe workspace names", () => {
    expect(sanitizeWorkspace("@scope/package")).toBe("scope__package");
  });

  test("namespaces suite and class names", () => {
    const xml =
      '<testsuite name="unit"><testcase classname="thing" name="works"/></testsuite>';
    const namespaced = namespaceJUnit(xml, "@scope/package");
    expect(namespaced).toContain('name="@scope/package::unit"');
    expect(namespaced).toContain('classname="@scope/package::thing"');
  });

  test("preserves diagnostic text while namespacing", () => {
    const diagnostic = "  001\n    indented output  ";
    const xml = `<testsuite name="unit"><testcase classname="thing" name="fails"><failure>${diagnostic}</failure><system-out>${diagnostic}</system-out></testcase></testsuite>`;
    const namespaced = namespaceJUnit(xml, "@scope/package");

    expect(namespaced).toContain(`<failure>${diagnostic}</failure>`);
    expect(namespaced).toContain(`<system-out>${diagnostic}</system-out>`);
  });

  test("escapes workspace and command names through the XML builder", () => {
    const xml = syntheticJUnit('package<&"', 'command<&"', 0.5, 2);
    expect(xml).toContain('name="package&lt;&amp;&quot;"');
    expect(xml).toContain('name="command&lt;&amp;&quot;"');
    expect(() => namespaceJUnit(xml, "workspace")).not.toThrow();
  });

  test("rejects empty suites", () => {
    expect(() =>
      namespaceJUnit('<testsuite name="unit"></testsuite>', "package"),
    ).toThrow("no test cases");
  });

  test("rejects malformed XML", () => {
    expect(() =>
      namespaceJUnit(
        '<testsuite name="unit"><testcase></testsuite>',
        "package",
      ),
    ).toThrow("malformed JUnit XML");
  });

  test("records command failures", () => {
    const xml = syntheticJUnit("package", "shell", 1.25, 7);
    expect(xml).toContain('failures="1"');
    expect(xml).toContain("status 7");
  });

  test("converts individual cargo results to JUnit", () => {
    const xml = cargoTestJUnit(
      {
        stdout: "",
        stderr: [
          "running 3 tests",
          "test crate::passes ... ok",
          "test crate::fails ... FAILED",
          "test crate::ignored ... ignored, platform only",
        ].join("\n"),
      },
      "cargo",
      2.5,
      101,
    );
    const namespaced = namespaceJUnit(xml, "@scope/package");
    expect(namespaced).toContain('name="crate::passes"');
    expect(namespaced).toContain('name="crate::fails"');
    expect(namespaced).toContain("<failure");
    expect(namespaced).toContain("<skipped");
  });

  test("records a Cargo invocation failure after earlier tests pass", () => {
    const xml = cargoTestJUnit(
      {
        stdout: ["running 1 test", "test crate::passes ... ok"].join("\n"),
        stderr: "error: linker exited with status 1",
      },
      "cargo",
      1,
      101,
    );
    const namespaced = namespaceJUnit(xml, "@scope/package");
    expect(namespaced).toContain('tests="2"');
    expect(namespaced).toContain('failures="1"');
    expect(namespaced).toContain('name="cargo invocation"');
  });

  test("removes a stale report before a test step runs", async () => {
    const reportPath = path.join(
      repositoryRoot,
      ".ci-reports",
      `stale-${process.pid.toString()}.xml`,
    );
    await Bun.write(reportPath, "<testsuite/>");
    await removeExistingReport(reportPath);
    expect(await Bun.file(reportPath).exists()).toBeFalse();
    await removeExistingReport(reportPath);
  });

  test("derives reported workspaces from emitted report paths", () => {
    const manifest = TestManifestSchema.parse({
      $schema: "./ci-test-manifest.schema.json",
      version: 1,
      workspaces: [
        {
          package: "@scope/package",
          directory: "packages/package",
          steps: [{ runner: "bun" }],
        },
      ],
      testlessWorkspaces: [],
      separateTests: [
        {
          package: "site",
          directory: "packages/site",
          reason: "Tests run separately.",
        },
      ],
    });
    expect(
      reportedWorkspacesForReports(manifest, [
        "scope__package/bun-1.xml",
        "site/playwright.xml",
        "scope__package/bun-2.xml",
      ]),
    ).toEqual(["@scope/package", "site"]);
    expect(() =>
      reportedWorkspacesForReports(manifest, ["unknown/test.xml"]),
    ).toThrow("unknown workspace");
  });

  test("preserves a failing test exit code when its report is missing", async () => {
    const missingReport = path.join(
      repositoryRoot,
      ".ci-reports",
      `missing-${process.pid.toString()}.xml`,
    );
    const completed = await completeJUnitReport({
      runner: "bun",
      reportPath: missingReport,
      workspace: "package",
      name: "unit",
      durationSeconds: 1,
      exitCode: 17,
    });

    expect(completed.exitCode).toBe(17);
    expect(completed.reportingError).toBeInstanceOf(Error);
  });
});

describe("Coverage report aggregation", () => {
  test("seeds every Bun metric for one-line reportless source", () => {
    const untouched = initialSourceCoverage(
      "export function untouched(value: boolean): number { return value ? 1 : 2; }",
      "src/untouched.ts",
    );

    expect(summarizeCoverageReports([untouched]).lines).toEqual({
      covered: 0,
      total: 1,
    });
    expect(summarizeCoverageReports([untouched]).functions).toEqual({
      covered: 0,
      total: 1,
    });
    expect(summarizeCoverageReports([untouched]).branches).toEqual({
      covered: 0,
      total: 2,
    });
  });

  test("counts executable source files that the test process never loads", () => {
    const covered = parseLcov(
      ["SF:src/covered.ts", "DA:1,1", "end_of_record"].join("\n"),
    );
    const untouched = initialSourceCoverage(
      "export function untouched(value: boolean): number { return value ? 1 : 2; }",
      "src/untouched.ts",
    );
    const summary = summarizeCoverageReports([covered, untouched]);

    expect(summary.lines?.covered).toBe(1);
    expect(summary.lines?.total).toBe(2);
    expect(summary.functions).toEqual({ covered: 0, total: 1 });
    expect(summary.branches).toEqual({ covered: 0, total: 2 });
  });

  test("seeds Bun-compatible executable lines for untouched functions", () => {
    const untouched = initialSourceCoverage(
      [
        "export function untouched(value: boolean): number {",
        "  return value ? 1 : 2;",
        "}",
      ].join("\n"),
      "src/untouched.ts",
    );

    expect(summarizeCoverageReports([untouched]).lines).toEqual({
      covered: 0,
      total: 2,
    });
  });

  test("marks producer-unsupported source metrics unavailable", () => {
    const initial = initialSourceCoverage(
      "export function choose(value: boolean): number { return value ? 1 : 2; }",
      "src/reported.ts",
    );
    const supplement = sourceCoverageSupplement(
      initial,
      new Set(["lines", "functions"]),
    );

    expect(supplement.points).toEqual([]);
    expect(supplement.unavailableMetrics).toEqual(["statements", "branches"]);
    expect(sourceCoverageSupplement(initial, undefined)).toBe(initial);
  });

  test("inventories workspace source without tests or nested workspaces", () => {
    expect(
      coverableWorkspaceSources(
        ["packages/parent", ".buildkite/scripts"],
        ["packages/parent", "packages/parent/packages/child"],
        [
          "packages/parent/src/index.ts",
          "packages/parent/src/index.test.ts",
          "packages/parent/src/generated/client.ts",
          "packages/parent/packages/child/src/index.ts",
          "packages/parent/eslint.config.ts",
          ".buildkite/scripts/upload-pipeline.ts",
          ".buildkite/scripts/upload-pipeline.test.ts",
          "packages/other/src/index.ts",
        ],
      ),
    ).toEqual([
      ".buildkite/scripts/upload-pipeline.ts",
      "packages/parent/src/index.ts",
    ]);
    expect(
      resolveCoverageSource(
        "/repo",
        "packages/parent",
        "packages/parent/src/index.ts",
      ),
    ).toBe(path.normalize("/repo/packages/parent/src/index.ts"));
    expect(
      resolveCoverageSource("/repo", "packages/parent", "src/index.ts"),
    ).toBe(path.normalize("/repo/packages/parent/src/index.ts"));
  });

  test("inventories production languages without coverage collection", () => {
    expect(
      uncoveredWorkspaceSources(
        ["packages/parent"],
        ["packages/parent", "packages/parent/packages/child"],
        [
          "packages/parent/src/page.astro",
          "packages/parent/src/main.rs",
          "packages/parent/src/tool.py",
          "packages/parent/src/native.swift",
          "packages/parent/src/query.ts",
          "packages/parent/src/main_test.py",
          "packages/parent/src/tests.rs",
          "packages/parent/tests/integration.rs",
          "packages/parent/generated/client.py",
          "packages/parent/packages/child/src/main.rs",
        ],
      ),
    ).toEqual([
      "packages/parent/src/main.rs",
      "packages/parent/src/native.swift",
      "packages/parent/src/page.astro",
      "packages/parent/src/tool.py",
    ]);
  });

  test("deduplicates LCOV locations without fabricating statements", () => {
    const first = parseLcov(
      [
        "TN:",
        "SF:first.ts",
        "FN:1,work",
        "FNDA:1,work",
        "DA:1,1",
        "DA:2,0",
        "BRDA:1,0,0,1",
        "BRDA:1,0,1,-",
        "end_of_record",
      ].join("\n"),
    );
    const second = parseLcov(
      [
        "TN:",
        "SF:first.ts",
        "FN:1,work",
        "FNDA:0,work",
        "DA:1,0",
        "DA:2,3",
        "BRDA:1,0,0,0",
        "BRDA:1,0,1,2",
        "end_of_record",
        "SF:second.ts",
        "DA:1,1",
        "end_of_record",
      ].join("\n"),
    );
    const merged = summarizeCoverageReports([first, second]);
    expect(merged.lines).toEqual({ covered: 3, total: 3 });
    expect(merged.functions).toEqual({ covered: 1, total: 1 });
    expect(merged.branches).toEqual({ covered: 2, total: 2 });
    expect(merged.statements).toBeUndefined();
    expect(coveragePercentage({ covered: 3, total: 4 })).toBe(75);
  });

  test("matches duplicate LCOV function names to definitions by occurrence", () => {
    const summary = summarizeCoverageReports([
      parseLcov(
        [
          "TN:",
          "SF:duplicate.ts",
          "FN:1,work",
          "FN:10,work",
          "FNDA:1,work",
          "FNDA:0,work",
          "DA:1,1",
          "DA:10,1",
          "end_of_record",
        ].join("\n"),
      ),
    ]);

    expect(summary.functions).toEqual({ covered: 1, total: 2 });
  });

  test("counts both duplicate LCOV function names when both are covered", () => {
    const summary = summarizeCoverageReports([
      parseLcov(
        [
          "TN:",
          "SF:duplicate.ts",
          "FN:1,work",
          "FN:10,work",
          "FNDA:1,work",
          "FNDA:2,work",
          "DA:1,1",
          "DA:10,1",
          "end_of_record",
        ].join("\n"),
      ),
    ]);

    expect(summary.functions).toEqual({ covered: 2, total: 2 });
  });
});

describe("Coverage producer totals", () => {
  test("preserves LCOV line totals beyond emitted DA records", () => {
    const summary = summarizeCoverageReports([
      parseLcov(
        [
          "SF:partial.ts",
          "DA:1,1",
          "DA:2,1",
          "DA:3,1",
          "DA:4,0",
          "LF:8",
          "LH:3",
          "end_of_record",
        ].join("\n"),
      ),
    ]);

    expect(summary.lines).toEqual({ covered: 3, total: 8 });
  });

  test("uses aggregate LCOV function and branch totals when details are absent", () => {
    const summary = summarizeCoverageReports([
      parseLcov(
        [
          "SF:aggregate.ts",
          "DA:1,1",
          "LF:1",
          "LH:1",
          "FNF:4",
          "FNH:2",
          "BRF:3",
          "BRH:1",
          "end_of_record",
        ].join("\n"),
      ),
    ]);

    expect(summary.functions).toEqual({ covered: 2, total: 4 });
    expect(summary.branches).toEqual({ covered: 1, total: 3 });
  });

  test("does not invent a union for overlapping anonymous LCOV totals", () => {
    const summaryOnlyLcov = [
      "SF:summary-only.ts",
      "DA:1,1",
      "FNF:4",
      "FNH:2",
      "BRF:4",
      "BRH:2",
      "end_of_record",
    ].join("\n");
    const summary = summarizeCoverageReports([
      parseLcov(summaryOnlyLcov),
      parseLcov(summaryOnlyLcov),
    ]);

    expect(summary.lines).toEqual({ covered: 1, total: 1 });
    expect(summary.functions).toBeUndefined();
    expect(summary.branches).toBeUndefined();
    expect(summary.unavailableMetrics).toEqual([
      "statements",
      "functions",
      "branches",
    ]);
    expect(
      sumCoverageMetrics([{ functions: { covered: 1, total: 1 } }, summary]),
    ).toEqual({
      lines: { covered: 1, total: 1 },
      unavailableMetrics: ["statements", "functions", "branches"],
    });
  });

  test("rejects LCOV summaries that conflict with detailed records", () => {
    expect(() =>
      parseLcov(
        [
          "SF:conflict.ts",
          "DA:1,1",
          "DA:2,1",
          "LF:1",
          "LH:1",
          "end_of_record",
        ].join("\n"),
      ),
    ).toThrow("summary conflicts with identified records");
  });

  test("parses and deduplicates Go statement coverage", () => {
    const goSummary = summarizeCoverageReports([
      parseGoCover(
        ["mode: set", "example.go:1.1,2.2 3 1", "example.go:4.1,5.2 2 0"].join(
          "\n",
        ),
      ),
      parseGoCover(["mode: set", "example.go:1.1,2.2 3 0"].join("\n")),
    ]);
    expect(goSummary).toEqual({
      statements: { covered: 3, total: 5 },
      unavailableMetrics: ["lines", "functions", "branches"],
    });

    const lcovSummary = summarizeCoverageReports([
      parseLcov(["SF:example.ts", "DA:1,1", "end_of_record"].join("\n")),
    ]);
    expect(sumCoverageMetrics([lcovSummary, goSummary])).toEqual({
      unavailableMetrics: ["lines", "statements", "functions", "branches"],
    });
  });

  test("keeps identical source locations distinct across workspaces", () => {
    const firstWorkspace = summarizeCoverageReports([
      parseLcov(["SF:src/index.ts", "DA:1,0", "end_of_record"].join("\n")),
    ]);
    const secondWorkspace = summarizeCoverageReports([
      parseLcov(["SF:src/index.ts", "DA:1,1", "end_of_record"].join("\n")),
    ]);

    expect(sumCoverageMetrics([firstWorkspace, secondWorkspace])).toEqual({
      lines: { covered: 1, total: 2 },
      unavailableMetrics: ["statements"],
    });
  });

  test("rejects malformed Go coverage", () => {
    expect(() =>
      parseGoCover(["mode: set", "example.go malformed"].join("\n")),
    ).toThrow("Malformed Go coverage profile line");
  });
});
describe("CI reporting manifest", () => {
  test("covers every declared test script without placeholder passes", async () => {
    const manifestJson = await Bun.file(
      path.join(import.meta.dir, "ci-test-manifest.json"),
    ).json();
    const manifest = TestManifestSchema.parse(manifestJson);
    const manifestJsonSchema = z
      .object({
        required: z.array(z.string()),
        properties: z.object({
          $schema: z.object({ const: z.string() }),
        }),
      })
      .parse(
        await Bun.file(
          path.join(import.meta.dir, "ci-test-manifest.schema.json"),
        ).json(),
      );
    expect(manifestJsonSchema.required).toContain("$schema");
    expect(manifestJsonSchema.properties.$schema.const).toBe(manifest.$schema);
    const rootPackage = RootPackageSchema.parse(
      await Bun.file(path.join(repositoryRoot, "package.json")).json(),
    );
    const workspaceDirectories = rootPackage.workspaces;
    const declaredDirectories = new Set(
      manifest.workspaces.map((entry) => entry.directory),
    );
    const noTestDirectories = new Set(
      manifest.testlessWorkspaces.map((entry) => entry.directory),
    );
    const separateTestDirectories = new Set(
      manifest.separateTests.map((entry) => entry.directory),
    );
    const webring = manifest.workspaces.find(
      (entry) => entry.directory === "packages/webring",
    );
    const homelab = manifest.workspaces.find(
      (entry) => entry.directory === "packages/homelab",
    );

    expect(declaredDirectories.size).toBe(manifest.workspaces.length);
    expect(noTestDirectories.size).toBe(manifest.testlessWorkspaces.length);
    expect(separateTestDirectories.size).toBe(manifest.separateTests.length);
    expect(
      [
        ...declaredDirectories,
        ...noTestDirectories,
        ...separateTestDirectories,
      ].sort(),
    ).toEqual([...workspaceDirectories].sort());
    expect(webring?.steps).toEqual([
      {
        runner: "command",
        name: "typedoc",
        command: ["bun", "run", "typedoc"],
      },
      { runner: "bun", args: ["src/"] },
    ]);
    expect(homelab?.steps).toEqual([
      {
        runner: "bun",
        args: [
          "scripts/argocd-manifest-overrides.test.ts",
          "scripts/helm-release-core.test.ts",
          "scripts/helm-set-version.test.ts",
          "scripts/lint-helm.test.ts",
          "scripts/migration-smoke.test.ts",
          "scripts/velero-backups.test.ts",
        ],
      },
    ]);
    // The Tauri crate (@scout-for-lol/desktop-rust) is intentionally listed in
    // testlessWorkspaces, not workspaces: its cargo tests require GTK/glib
    // system libraries in the ci-base image, which only rebuilds on main after
    // verify. Reporting for it is deferred until an image-only change lands
    // those prerequisites on main.
    expect(
      manifest.workspaces.some(
        (entry) => entry.package === "@scout-for-lol/desktop-rust",
      ),
    ).toBeFalse();
    expect(
      manifest.testlessWorkspaces.some(
        (entry) => entry.package === "@scout-for-lol/desktop-rust",
      ),
    ).toBeTrue();

    for (const directory of workspaceDirectories) {
      const packageJsonPath = path.join(
        repositoryRoot,
        directory,
        "package.json",
      );
      const packageJson = WorkspacePackageSchema.parse(
        await Bun.file(packageJsonPath).json(),
      );
      const scripts = packageJson.scripts ?? {};
      if (typeof scripts["test"] === "string") {
        expect(declaredDirectories.has(directory)).toBeTrue();
      }
      if (declaredDirectories.has(directory)) {
        const manifestEntry = manifest.workspaces.find(
          (entry) => entry.directory === directory,
        );
        if (manifestEntry === undefined) {
          throw new Error(`Missing manifest entry for ${directory}`);
        }
        const relativeRunner = path.relative(
          directory,
          "scripts/run-ci-test.ts",
        );
        const usesCoverage = manifestEntry.steps.some(
          (step) => step.runner !== "cargo" && step.runner !== "command",
        );
        const expectedReportScript = usesCoverage
          ? `CI_TEST_COVERAGE=1 bun ${relativeRunner}`
          : `bun ${relativeRunner}`;
        expect(scripts["test:report"]).toBe(expectedReportScript);
        expect(scripts["test:ci"]).toBe(
          scripts["test:report"] === `bun ${relativeRunner}`
            ? "bun run test:report"
            : `bun ${relativeRunner}`,
        );
      }
      if (noTestDirectories.has(directory)) {
        expect(
          Object.keys(scripts).filter(
            (name) => name === "test" || name.startsWith("test:"),
          ),
        ).toEqual([]);
      }
    }
  });

  test("hashes shared runner inputs and serializes CDK8s test reports after build", async () => {
    const rootTurbo = await Bun.file(
      path.join(repositoryRoot, "turbo.json"),
    ).text();
    for (const reportingInput of [
      "scripts/ci-reporting.ts",
      "scripts/ci-test-manifest.json",
      "scripts/run-ci-test.ts",
    ]) {
      expect(rootTurbo).toContain(`"${reportingInput}"`);
    }
    expect(rootTurbo).toContain(
      '"//#script-coverage": {\n      "dependsOn": ["//#check-script-migrations"],\n      "cache": false,',
    );

    const cdk8sTurbo = await Bun.file(
      path.join(repositoryRoot, "packages/homelab/src/cdk8s/turbo.json"),
    ).text();
    expect(cdk8sTurbo).toContain(
      '"test:ci": {\n      "dependsOn": ["build", "^build", "generate"],\n      "env": ["NODE_ENV"]\n    }',
    );
    expect(cdk8sTurbo).toContain(
      '"test:report": {\n      "dependsOn": ["build", "^build", "generate"],\n      "env": ["NODE_ENV"]\n    }',
    );
  });

  test("test:ci preserves package-specific test hashing inputs", async () => {
    for (const [turboPath, expectedTask] of [
      [
        "packages/birmel/turbo.json",
        '"test:ci": {\n      "env": ["NODE_ENV"],\n      "inputs": ["$TURBO_DEFAULT$", ".env.test"]\n    }',
      ],
      [
        "packages/scout-for-lol/packages/backend/turbo.json",
        '"test:ci": {\n      "env": ["DATABASE_URL"]\n    }',
      ],
    ] satisfies readonly (readonly [string, string])[]) {
      const turbo = await Bun.file(path.join(repositoryRoot, turboPath)).text();
      expect(turbo).toContain(expectedTask);
    }
  });
});
