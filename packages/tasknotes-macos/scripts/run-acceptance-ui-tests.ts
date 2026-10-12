import assert from "node:assert/strict";
import { cp, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  acceptanceSigningArguments,
  assertExactStandaloneResults,
  expectedStandaloneTitles,
  selectStandaloneTests,
  standaloneSelector,
  standaloneTests,
  verifyStandaloneNotes,
  type StandaloneTest,
} from "./acceptance-test-plan.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const fixture = path.resolve(
  packageRoot,
  "../tasknotes-fixtures/e2e/local-vault",
);

async function command(argv: string[], capture = false): Promise<string> {
  const process = Bun.spawn(argv, {
    cwd: packageRoot,
    env: { ...Bun.env, MISE_EXEC_AUTO_INSTALL: "false" },
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const output = capture ? await new Response(process.stdout).text() : "";
  const status = await process.exited;
  if (status !== 0) {
    throw new Error(`${argv.slice(0, 2).join(" ")} exited ${String(status)}`);
  }
  return output.trim();
}

/** Real native suite, with a sandbox and Keychain namespace separate from users. */
export async function runAcceptanceUiTests(
  tests: readonly StandaloneTest[] = standaloneTests,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Native acceptance requires macOS and Xcode.");
  }
  const runID = crypto.randomUUID();
  const signing = acceptanceSigningArguments(
    Bun.env["TASKNOTES_UITEST_IDENTITY"],
  );
  assert.ok(tests.length > 0, "At least one standalone test must be selected");
  assert.equal(
    new Set(tests).size,
    tests.length,
    "Duplicate standalone test selection",
  );
  const selectedTests = tests.map(standaloneSelector);
  const derived = path.join(packageRoot, ".build/acceptance-xcode");
  const evidence = path.join(packageRoot, ".build/native-acceptance", runID);
  const container = path.join(
    homedir(),
    "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data",
  );
  const directory = path.join(
    container,
    "Library/Application Support/FacetAcceptance",
    runID,
  );
  const descriptor = path.join(directory, "acceptance.json");
  const vault = path.join(directory, "Native acceptance");
  await mkdir(evidence, { recursive: true });
  const receipt = {
    schemaVersion: 1,
    runID,
    kind: "native-local-macos",
    selectedTests,
    resultBundle: "Smoke.xcresult",
    accountEntryCaptured: false,
    remoteVaultAuthorized: false,
  };
  await Bun.write(
    path.join(evidence, "run.json"),
    JSON.stringify({ ...receipt, status: "building" }, null, 2),
  );
  await command(["bun", "run", "mac:preflight"]);
  await command(["xcodegen", "generate"]);
  await command([
    "xcodebuild",
    "build-for-testing",
    "-project",
    "TaskNotes.xcodeproj",
    "-scheme",
    "TaskNotesAcceptance",
    "-configuration",
    "Debug",
    "-derivedDataPath",
    derived,
    "-destination",
    "platform=macOS",
    "-parallel-testing-enabled",
    "NO",
    ...signing,
  ]);
  await mkdir(directory, { recursive: true });
  await Bun.write(
    descriptor,
    JSON.stringify({
      schemaVersion: 1,
      runID,
      stateDirectory: directory,
    }),
  );
  await cp(fixture, vault, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const testRuns = await Array.fromAsync(
    new Bun.Glob("*.xctestrun").scan({
      cwd: path.join(derived, "Build/Products"),
      absolute: true,
    }),
  );
  assert.equal(
    testRuns.length,
    1,
    "Expected one generated acceptance test run",
  );
  const testRun = testRuns[0];
  assert.ok(testRun);
  for (const [key, value] of Object.entries({
    FACET_E2E_DESCRIPTOR: descriptor,
    FACET_E2E_RUN_ID: runID,
  })) {
    await command([
      "plutil",
      "-replace",
      `TaskNotesAcceptanceUITests.EnvironmentVariables.${key}`,
      "-string",
      value,
      testRun,
    ]);
  }
  for (const [kind, lifetime] of [
    ["SystemAttachmentLifetime", "keepNever"],
    ["UserAttachmentLifetime", "keepAlways"],
  ] as const)
    await command([
      "plutil",
      "-replace",
      `TaskNotesAcceptanceUITests.${kind}`,
      "-string",
      lifetime,
      testRun,
    ]);
  const result = path.join(evidence, "Smoke.xcresult");
  const failures: unknown[] = [];
  try {
    await command([
      "xcodebuild",
      "test-without-building",
      "-xctestrun",
      testRun,
      "-destination",
      "platform=macOS",
      "-parallel-testing-enabled",
      "NO",
      "-resultBundlePath",
      result,
      "-collect-test-diagnostics",
      "never",
      ...selectedTests.map((test) => `-only-testing:${test}`),
    ]);
    const reports = await Promise.all(
      ["summary", "tests"].map((kind) =>
        command(
          [
            "xcrun",
            "xcresulttool",
            "get",
            "test-results",
            kind,
            "--compact",
            "--path",
            result,
          ],
          true,
        ),
      ),
    );
    const [summaryJSON, testsJSON] = reports;
    assert.ok(
      summaryJSON && testsJSON,
      "Native result summary and test tree are required",
    );
    await Promise.all([
      Bun.write(path.join(evidence, "test-summary.json"), summaryJSON),
      Bun.write(path.join(evidence, "test-tree.json"), testsJSON),
    ]);
    const summary: unknown = JSON.parse(summaryJSON);
    const testTree: unknown = JSON.parse(testsJSON);
    assertExactStandaloneResults(summary, testTree, tests);
    for (const relative of [
      "Tasks/Existing.md",
      "Reference.md",
      "tasknotes.yaml",
    ]) {
      assert.deepEqual(
        await readFile(path.join(vault, relative)),
        await readFile(path.join(fixture, relative)),
      );
    }
    const notes = await Array.fromAsync(
      new Bun.Glob("**/*.md").scan({ cwd: vault }),
    );
    const created = notes.filter(
      (note) => !["Tasks/Existing.md", "Reference.md"].includes(note),
    );
    verifyStandaloneNotes(
      await Promise.all(
        created.map((note) => readFile(path.join(vault, note), "utf8")),
      ),
      expectedStandaloneTitles(tests, runID),
    );
  } catch (error) {
    failures.push(error);
  }
  for (const retain of [
    () => cp(directory, path.join(evidence, "state"), { recursive: true }),
    () =>
      command([
        "xcrun",
        "xcresulttool",
        "export",
        "attachments",
        "--path",
        result,
        "--output-path",
        path.join(evidence, "screenshots"),
      ]),
  ]) {
    try {
      await retain();
    } catch (error) {
      failures.push(error);
    }
  }
  // Keep the private run until its proof is reviewed. Never remove a container,
  // Keychain service or data belonging to another acceptance run.
  await Bun.write(
    path.join(evidence, "run.json"),
    JSON.stringify(
      {
        ...receipt,
        status: failures.length > 0 ? "failed" : "passed",
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Native acceptance failed; retained ${evidence}`,
    );
  }
  console.log(`Native local acceptance passed: ${evidence}`);
}

if (import.meta.main) {
  await runAcceptanceUiTests(selectStandaloneTests(Bun.argv.slice(2)));
}
