import { describe, expect, test } from "vitest";
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

const repositoryRoot = path.resolve(import.meta.dir, "..", "..");
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
      version: 2,
      workspaces: [
        {
          package: "package",
          directory: "packages/package",
          steps: [{ runner: "vitest" }],
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
    ).toBe(false);
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        workspaces: [{ ...validManifest.workspaces[0], defaultENV: {} }],
      }).success,
    ).toBe(false);
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        workspaces: [
          {
            ...validManifest.workspaces[0],
            steps: [{ runner: "vitest", arg: "test.ts" }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        testlessWorkspaces: [
          { ...validManifest.testlessWorkspaces[0], typo: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      TestManifestSchema.safeParse({
        ...validManifest,
        separateTests: [{ ...validManifest.separateTests[0], typo: true }],
      }).success,
    ).toBe(false);
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
        // A documented exclusion must reference a real suite file or directory
        // so it cannot rot into a stale claim once the test is renamed or removed.
        expect(await Bun.file(suitePath).stat()).toBeDefined();
      }
    }
  });

  test("rejects an excluded suite that a reporting step still runs", () => {
    const manifest = TestManifestSchema.parse({
      $schema: "./ci-test-manifest.schema.json",
      version: 2,
      workspaces: [
        {
          package: "package",
          directory: "packages/package",
          steps: [{ runner: "vitest", args: ["src", "contract-tests"] }],
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

  test("allows a documented suite excluded by a broad Vitest filter", () => {
    const manifest = TestManifestSchema.parse({
      $schema: "./ci-test-manifest.schema.json",
      version: 2,
      workspaces: [
        {
          package: "package",
          directory: "packages/package",
          steps: [
            {
              runner: "vitest",
              args: ["src", "--exclude", "src/emulator/audio.test.ts"],
            },
          ],
          excludedSuites: [
            {
              path: "src/emulator/audio.test.ts",
              reason: "Runs in a dedicated image verification stage.",
            },
          ],
        },
      ],
      testlessWorkspaces: [],
      separateTests: [],
    });
    expect(() => {
      assertExcludedSuitesAreUncovered(manifest);
    }).not.toThrow();
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
    expect(await Bun.file(reportPath).exists()).toBe(false);
    await removeExistingReport(reportPath);
  });

  test("derives reported workspaces from emitted report paths", () => {
    const manifest = TestManifestSchema.parse({
      $schema: "./ci-test-manifest.schema.json",
      version: 2,
      workspaces: [
        {
          package: "@scope/package",
          directory: "packages/package",
          steps: [{ runner: "vitest" }],
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
        "scope__package/vitest-1.xml",
        "site/playwright.xml",
        "scope__package/vitest-2.xml",
      ]),
    ).toEqual(["@scope/package", "site"]);
    expect(() =>
      reportedWorkspacesForReports(manifest, ["unknown/test.xml"]),
    ).toThrow("unknown workspace");
  });

  test("synthesizes a failing JUnit case when a runner emits no report", async () => {
    const missingReport = path.join(
      repositoryRoot,
      ".ci-reports",
      `missing-${process.pid.toString()}.xml`,
    );
    try {
      const completed = await completeJUnitReport({
        runner: "vitest",
        reportPath: missingReport,
        workspace: "package",
        name: "unit",
        durationSeconds: 1,
        exitCode: 17,
      });

      expect(completed).toEqual({ exitCode: 17 });
      const xml = await Bun.file(missingReport).text();
      expect(xml).toContain('name="package::unit"');
      expect(xml).toContain('message="command exited with status 17"');
    } finally {
      const report = Bun.file(missingReport);
      if (await report.exists()) {
        await report.delete();
      }
    }
  });
});

describe("CI reporting manifest", () => {
  test("covers every declared test script without placeholder passes", async () => {
    const manifestJson = await Bun.file(
      path.join(import.meta.dir, "..", "ci-test-manifest.json"),
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
          path.join(import.meta.dir, "..", "ci-test-manifest.schema.json"),
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
    const temporal = manifest.workspaces.find(
      (entry) => entry.directory === "packages/temporal",
    );
    const scoutTemporal = manifest.workspaces.find(
      (entry) => entry.directory === "packages/scout-for-lol/packages/temporal",
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
      { runner: "vitest", args: ["src/"] },
    ]);
    expect(homelab?.steps).toEqual([
      {
        runner: "vitest",
        args: [
          "scripts/argocd/argocd-manifest-overrides.test.ts",
          "scripts/argocd/argocd-ignored-differences.test.ts",
          "scripts/scripts-typecheck.test.ts",
          "scripts/helm/helm-release-core.test.ts",
          "scripts/helm/helm-set-version.test.ts",
          "scripts/helm/lint-helm.test.ts",
          "scripts/migration-smoke.test.ts",
          "scripts/velero-backups.test.ts",
          "scripts/argocd/argocd-apply-safety.test.ts",
          "scripts/argocd/argocd-auto-sync-policy.test.ts",
          "scripts/argocd/argocd-child-sync-timeout.test.ts",
          "scripts/argocd/argocd-release-result.test.ts",
          "scripts/tofu/tofu-stack.test.ts",
          "scripts/tofu/credential-handoff.test.ts",
          "scripts/tofu/application-secrets.integration.test.ts",
        ],
      },
    ]);
    expect(temporal?.steps.at(-1)).toEqual({
      runner: "vitest",
      name: "workflows",
      runtime: "node",
      runtimeReason:
        "The Temporal SDK worker requires authentic Node worker_threads, VM, promise hooks, and native worker support; Bun 1.4 exits the workflow thread with code 1.",
      args: [
        "src/workflows",
        "--exclude",
        "src/workflows/agent-task.test.ts",
        "--no-file-parallelism",
      ],
    });
    expect(scoutTemporal?.steps.at(-1)).toEqual({
      runner: "vitest",
      name: "workflows",
      runtime: "node",
      runtimeReason:
        "The Temporal SDK worker requires authentic Node worker_threads, VM, promise hooks, and native worker support; Bun 1.4 exits the workflow thread with code 1.",
      args: ["src/workflows", "--no-file-parallelism"],
    });
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
        expect(declaredDirectories.has(directory)).toBe(true);
      }
      if (declaredDirectories.has(directory)) {
        const manifestEntry = manifest.workspaces.find(
          (entry) => entry.directory === directory,
        );
        if (manifestEntry === undefined) {
          throw new Error(`Missing manifest entry for ${directory}`);
        }
        const relativeRunner = path
          .relative(directory, "scripts/ci/run-ci-test.ts")
          .split(path.sep)
          .join("/");
        expect(scripts["test:ci"]).toBe(`bun ${relativeRunner}`);
        expect(scripts["test:report"]).toBeUndefined();
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

  test("keeps script coverage cached and serializes CDK8s test reports after build", async () => {
    const rootTurbo = await Bun.file(
      path.join(repositoryRoot, "turbo.json"),
    ).text();
    expect(rootTurbo).toContain(
      '"//#script-coverage": {\n      "dependsOn": ["//#check-script-migrations"],\n      "inputs": [',
    );
    expect(rootTurbo).not.toContain(
      '"//#script-coverage": {\n      "dependsOn": ["//#check-script-migrations"],\n      "cache": false,',
    );

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
        '"test:ci": {\n      "env": ["NODE_ENV"],\n      "inputs": ["$TURBO_EXTENDS$", ".env.test"]\n    }',
      ],
      [
        "packages/scout-for-lol/packages/backend/turbo.json",
        '"test:ci": {\n      "env": ["DATABASE_URL", "SCOUT_PG_PORT"],\n      "passThroughEnv": ["MISE_DATA_DIR"]\n    }',
      ],
    ] satisfies readonly (readonly [string, string])[]) {
      const turbo = await Bun.file(path.join(repositoryRoot, turboPath)).text();
      expect(turbo).toContain(expectedTask);
    }
  });
});

describe("test:ci runner inputs", () => {
  test("hashes the shared runner into test:ci rather than every task", async () => {
    const rootTurbo = await Bun.file(
      path.join(repositoryRoot, "turbo.json"),
    ).text();
    const runnerInputs = [
      "$TURBO_ROOT$/scripts/ci/ci-reporting.ts",
      "$TURBO_ROOT$/scripts/ci-test-manifest.json",
      "$TURBO_ROOT$/scripts/ci/run-ci-test.ts",
      "$TURBO_ROOT$/scripts/ci/gradle-junit.ts",
      "$TURBO_ROOT$/scripts/ci/mstest-configuration.ts",
    ];
    const RootTurboSchema = z.object({
      globalDependencies: z.array(z.string()),
      tasks: z.record(
        z.string(),
        z.object({ inputs: z.array(z.string()).optional() }).loose(),
      ),
    });
    const root = RootTurboSchema.parse(Bun.JSONC.parse(rootTurbo));
    expect(root.tasks["test:ci"]?.inputs).toEqual(
      expect.arrayContaining(["$TURBO_DEFAULT$", ...runnerInputs]),
    );
    for (const input of runnerInputs) {
      expect(root.globalDependencies).not.toContain(
        input.replace("$TURBO_ROOT$/", ""),
      );
    }
    // A package override replaces the root inputs unless it extends them.
    const PackageTurboSchema = z.object({
      tasks: z
        .record(
          z.string(),
          z.object({ inputs: z.array(z.string()).optional() }).loose(),
        )
        .optional(),
    });
    const manifest = TestManifestSchema.parse(
      await Bun.file(
        path.join(repositoryRoot, "scripts/ci-test-manifest.json"),
      ).json(),
    );
    for (const { directory } of manifest.workspaces) {
      const turboFile = Bun.file(
        path.join(repositoryRoot, directory, "turbo.json"),
      );
      if (!(await turboFile.exists())) continue;
      const config = PackageTurboSchema.parse(
        Bun.JSONC.parse(await turboFile.text()),
      );
      const inputs = config.tasks?.["test:ci"]?.inputs;
      if (inputs === undefined || inputs[0] === "$TURBO_EXTENDS$") continue;
      expect(inputs, directory).toEqual(expect.arrayContaining(runnerInputs));
    }
  });
});
