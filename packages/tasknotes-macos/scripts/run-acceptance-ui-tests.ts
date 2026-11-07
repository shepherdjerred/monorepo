import assert from "node:assert/strict";
import { cp, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  configureMacAcceptanceTestRun,
  macAcceptanceTestRun,
  type MacJourneyCommand,
} from "./apple-acceptance/mac-journey.ts";
import { isMacSessionPreflightFailure } from "./apple-acceptance/mac-session.ts";
import {
  acceptanceStages,
  executeAcceptanceStages,
  readAcceptanceResultReports,
} from "./acceptance-execution.ts";
import {
  acceptanceSigningArguments,
  assertExactStandaloneResults,
  expectedStandaloneTitles,
  isFullStandaloneSelection,
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
  options: {
    launchSmokeOnly?: boolean;
    prepared?: {
      runID: string;
      evidence: string;
      derived: string;
      fixture: string;
      runnerBundlePath: string;
      command: MacJourneyCommand;
      verifyInputs: () => Promise<void>;
      provenance: Record<string, unknown>;
    };
  } = {},
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Native acceptance requires macOS and Xcode.");
  }
  const prepared = options.prepared;
  const execute = prepared?.command ?? command;
  const seed = prepared?.fixture ?? fixture;
  const runID = prepared?.runID ?? crypto.randomUUID();
  assert.ok(tests.length > 0, "At least one standalone test must be selected");
  assert.equal(
    new Set(tests).size,
    tests.length,
    "Duplicate standalone test selection",
  );
  const smokeOnly = options.launchSmokeOnly === true;
  const selectedTests = smokeOnly ? [] : tests.map(standaloneSelector);
  const derived =
    prepared?.derived ?? path.join(packageRoot, ".build/acceptance-xcode");
  const evidence =
    prepared?.evidence ??
    path.join(packageRoot, ".build/native-acceptance", runID);
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
  const stages = acceptanceStages(tests, evidence, smokeOnly);
  const result = path.join(
    evidence,
    smokeOnly ? "LaunchSmoke.xcresult" : "Smoke.xcresult",
  );
  const receipt = {
    ...prepared?.provenance,
    schemaVersion: 1,
    runID,
    kind: smokeOnly ? "native-launch-smoke-macos" : "native-local-macos",
    selectedTests,
    launchSmoke: stages[0]?.selector,
    stages: stages.map((stage) => ({
      selector: stage.selector,
      resultBundle: path.basename(stage.resultBundle),
    })),
    resultBundle: path.basename(result),
    fullAcceptance: !smokeOnly && isFullStandaloneSelection(tests),
    accountEntryCaptured: false,
    remoteVaultAuthorized: false,
  };
  await Bun.write(
    path.join(evidence, "run.json"),
    JSON.stringify({ ...receipt, status: "building" }, null, 2),
  );
  if (prepared) await prepared.verifyInputs();
  else {
    const signing = acceptanceSigningArguments(
      Bun.env["TASKNOTES_UITEST_IDENTITY"],
    );
    await execute(["bun", "run", "mac:preflight"]);
    await execute(["xcodegen", "generate"]);
    await execute([
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
  }
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  await Bun.write(
    descriptor,
    JSON.stringify({
      schemaVersion: 1,
      runID,
      stateDirectory: directory,
    }),
  );
  await cp(seed, vault, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const testRun = await macAcceptanceTestRun(derived);
  await configureMacAcceptanceTestRun(
    testRun,
    {
      FACET_E2E_DESCRIPTOR: descriptor,
      FACET_E2E_RUN_ID: runID,
      ...(prepared ? { FACET_E2E_ISOLATED_BUILD_RUN_ID: runID } : {}),
    },
    execute,
    prepared?.runnerBundlePath,
  );
  const failures: unknown[] = [];
  try {
    await executeAcceptanceStages(stages, testRun, execute);
    if (!smokeOnly) {
      const workflows = stages.filter((stage) => stage.kind === "workflow");
      if (workflows.length === 1) {
        const workflow = workflows[0];
        assert.ok(workflow);
        await cp(workflow.resultBundle, result, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      } else {
        await execute([
          "xcrun",
          "xcresulttool",
          "merge",
          "--output-path",
          result,
          ...workflows.map((stage) => stage.resultBundle),
        ]);
      }
    }
    const { summaryJSON, testsJSON } = await readAcceptanceResultReports(
      result,
      {
        summary: path.join(evidence, "test-summary.json"),
        tests: path.join(evidence, "test-tree.json"),
      },
      execute,
    );
    const summary: unknown = JSON.parse(summaryJSON);
    const testTree: unknown = JSON.parse(testsJSON);
    if (!smokeOnly) assertExactStandaloneResults(summary, testTree, tests);
    for (const relative of [
      "Tasks/Existing.md",
      "Reference.md",
      "tasknotes.yaml",
    ]) {
      assert.deepEqual(
        await readFile(path.join(vault, relative)),
        await readFile(path.join(seed, relative)),
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
      smokeOnly ? [] : expectedStandaloneTitles(tests, runID),
    );
    if (prepared) await prepared.verifyInputs();
  } catch (error) {
    failures.push(error);
  }
  const retainedResults = (await Bun.file(
    path.join(result, "Info.plist"),
  ).exists())
    ? [result]
    : (
        await Promise.all(
          stages.map(async (stage) =>
            (await Bun.file(stage.receipt).exists())
              ? stage.resultBundle
              : undefined,
          ),
        )
      ).filter((bundle): bundle is string => bundle !== undefined);
  for (const retain of [
    () => cp(directory, path.join(evidence, "state"), { recursive: true }),
    ...retainedResults.map(
      (bundle) => () =>
        execute([
          "xcrun",
          "xcresulttool",
          "export",
          "attachments",
          "--path",
          bundle,
          "--output-path",
          bundle === result
            ? path.join(evidence, "screenshots")
            : path.join(
                evidence,
                "screenshots",
                path.basename(bundle, ".xcresult"),
              ),
        ]),
    ),
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
        status: failures.some(isMacSessionPreflightFailure)
          ? "blocked"
          : failures.length > 0
            ? "failed"
            : "passed",
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
  console.log(
    `${smokeOnly ? "Native launch smoke" : "Native local acceptance"} passed: ${evidence}`,
  );
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length === 1 && args[0] === "--launch-smoke-only") {
    await runAcceptanceUiTests(standaloneTests, { launchSmokeOnly: true });
  } else {
    await runAcceptanceUiTests(selectStandaloneTests(args));
  }
}
