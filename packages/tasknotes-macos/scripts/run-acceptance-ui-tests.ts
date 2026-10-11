import assert from "node:assert/strict";
import { cp, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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
export async function runAcceptanceUiTests(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Native acceptance requires macOS and Xcode.");
  }
  const runID = crypto.randomUUID();
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
  await command([
    "plutil",
    "-replace",
    "TaskNotesAcceptanceUITests.SystemAttachmentLifetime",
    "-string",
    "keepAlways",
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
      "-only-testing:TaskNotesAcceptanceUITests/StandaloneVaultUITests",
    ]);
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
    assert.equal(
      notes.length,
      3,
      "Only the original notes and one capture may exist",
    );
    const created = notes.find(
      (note) => !["Tasks/Existing.md", "Reference.md"].includes(note),
    );
    assert.ok(created);
    const bytes = await readFile(path.join(vault, created), "utf8");
    assert.match(
      bytes,
      new RegExp(`^title: ["']?Native Mac ${runID} edited["']?$`, "mu"),
    );
    console.log(`Native local acceptance passed: ${evidence}`);
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
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Native acceptance failed; retained ${evidence}`,
    );
  }
}

if (import.meta.main) {
  await runAcceptanceUiTests();
}
