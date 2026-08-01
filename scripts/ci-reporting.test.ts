import { describe, expect, test } from "bun:test";
import path from "node:path";
import { z } from "zod";
import {
  applyDefaultEnvironment,
  cargoTestJUnit,
  completeJUnitReport,
  namespaceJUnit,
  removeExistingReport,
  reportedWorkspacesForReports,
  sanitizeWorkspace,
  syntheticJUnit,
  TestManifestSchema,
} from "./ci-reporting.ts";

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
    expect(
      manifest.workspaces.find(
        (entry) => entry.package === "@scout-for-lol/desktop-rust",
      )?.steps,
    ).toEqual([{ runner: "cargo", args: ["--locked", "--all-features"] }]);
    const desktopDirectory =
      "packages/scout-for-lol/packages/desktop/src-tauri";
    expect(
      await Bun.file(
        path.join(repositoryRoot, desktopDirectory, "Cargo.lock"),
      ).exists(),
    ).toBeTrue();
    expect(
      await Bun.file(
        path.join(
          repositoryRoot,
          "packages/scout-for-lol/packages/desktop/.gitignore",
        ),
      ).text(),
    ).not.toContain("/src-tauri/Cargo.lock");

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
        // Cargo/command-only workspaces cannot call the Bun runner directly from
        // test:ci, so they indirect through a test:report script that invokes the
        // runner; workspaces with a Bun step call the runner straight from test:ci.
        const hasBunStep = manifestEntry.steps.some(
          (step) => step.runner !== "cargo" && step.runner !== "command",
        );
        if (hasBunStep) {
          expect(scripts["test:ci"]).toBe(`bun ${relativeRunner}`);
        } else {
          expect(scripts["test:report"]).toBe(`bun ${relativeRunner}`);
          expect(scripts["test:ci"]).toBe("bun run test:report");
        }
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

    const cdk8sTurbo = await Bun.file(
      path.join(repositoryRoot, "packages/homelab/src/cdk8s/turbo.json"),
    ).text();
    expect(cdk8sTurbo).toContain(
      '"test:ci": {\n      "dependsOn": ["build", "^build", "generate"],\n      "env": ["NODE_ENV"]\n    }',
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
