import assert from "node:assert/strict";
import { cp, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { boundedCommand } from "../apple-acceptance/bounded-command.ts";
import { retireMacRun } from "../apple-acceptance/native-owner.ts";
import { launchJournal } from "../apple-acceptance/retained-owner.ts";
import {
  requireStableSources,
  sourceFingerprints,
} from "../apple-acceptance/source-provenance.ts";
import { readAcceptanceResultReports } from "../acceptance-execution.ts";
import {
  acceptanceSigningArguments,
  assertExactNativeResults,
} from "../acceptance-test-plan.ts";
import {
  seedOccurrenceVault,
  verifyOccurrenceVault,
  viewerDay,
} from "./fixture.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const test = "testGenerationRepairUndoAndColdRelaunch";
const selector = `TaskNotesAcceptanceUITests/OccurrenceVaultUITests/${test}`;

/** Compile first, then run one owned window journey without opening a folder picker. */
export async function runMacOccurrenceAcceptance(): Promise<void> {
  assert.equal(process.platform, "darwin");
  assert.equal(Bun.argv.length, 2, "The recurrence runner takes no arguments");
  const runID = crypto.randomUUID();
  const evidence = path.join(
    packageRoot,
    ".build/occurrence-acceptance",
    runID,
  );
  const derived = path.join(evidence, "macos");
  const command = (argv: string[], capture = false, cwd = packageRoot) =>
    boundedCommand(argv, {
      cwd,
      capture,
      logs: path.join(evidence, "commands"),
      timeoutMS: argv.includes("build-for-testing")
        ? 600_000
        : argv.includes("test-without-building")
          ? 240_000
          : 60_000,
    });
  const fingerprints = () =>
    sourceFingerprints(path.resolve(packageRoot, "../.."), (argv) =>
      command(argv, true, path.resolve(packageRoot, "../..")),
    );
  const state = path.join(
    homedir(),
    "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data/Library/Application Support/FacetAcceptance",
    runID,
  );
  const descriptor = path.join(state, "acceptance.json");
  const vault = path.join(state, "Native acceptance");
  const result = path.join(evidence, "Occurrence.xcresult");
  const executable = path.join(
    derived,
    "Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
  );
  await mkdir(evidence, { recursive: true });
  const sources = await fingerprints();
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
    "-jobs",
    "2",
    ...acceptanceSigningArguments(Bun.env["TASKNOTES_UITEST_IDENTITY"]),
  ]);
  requireStableSources(sources, await fingerprints());
  const binding = { runID, descriptor, executable };
  await retireMacRun(binding, null, evidence);
  const day = viewerDay();
  await mkdir(path.dirname(state), { recursive: true, mode: 0o700 });
  await mkdir(state, { recursive: false, mode: 0o700 });
  await Bun.write(
    descriptor,
    JSON.stringify({ schemaVersion: 1, runID, stateDirectory: state }),
  );
  await seedOccurrenceVault(vault, day);
  const testRuns = await Array.fromAsync(
    new Bun.Glob("*.xctestrun").scan({
      cwd: path.join(derived, "Build/Products"),
      absolute: true,
    }),
  );
  assert.equal(testRuns.length, 1);
  const testRun = testRuns[0];
  assert.ok(testRun);
  for (const [key, value] of Object.entries({
    FACET_E2E_DESCRIPTOR: descriptor,
    FACET_E2E_RUN_ID: runID,
    FACET_OCCURRENCE_DAY: day,
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
  for (const [key, value] of [
    ["SystemAttachmentLifetime", "keepNever"],
    ["UserAttachmentLifetime", "keepAlways"],
  ]) {
    assert.ok(key && value);
    await command([
      "plutil",
      "-replace",
      `TaskNotesAcceptanceUITests.${key}`,
      "-string",
      value,
      testRun,
    ]);
  }
  const receipt = {
    schemaVersion: 1,
    runID,
    day,
    kind: "native-occurrence-macos",
    selector,
    accountEntryCaptured: false,
    remoteVaultAuthorized: false,
    sources,
  };
  await Bun.write(
    path.join(evidence, "run.json"),
    JSON.stringify({ ...receipt, status: "running" }, null, 2),
  );
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
      "-test-timeouts-enabled",
      "YES",
      "-maximum-test-execution-time-allowance",
      "180",
      `-only-testing:${selector}`,
    ]);
    const reports = await readAcceptanceResultReports(
      result,
      {
        summary: path.join(evidence, "summary.json"),
        tests: path.join(evidence, "tests.json"),
      },
      command,
    );
    assertExactNativeResults(
      JSON.parse(reports.summaryJSON),
      JSON.parse(reports.testsJSON),
      [test],
      { target: "TaskNotesAcceptanceUITests", suite: "OccurrenceVaultUITests" },
    );
    const primary: unknown = await Bun.file(
      path.join(state, "occurrence-primary.json"),
    ).json();
    assert.ok(typeof primary === "object" && primary !== null);
    assert.deepEqual(Object.keys(primary).sort(), [
      "child",
      "day",
      "parent",
      "runID",
      "schemaVersion",
    ]);
    assert.equal(Reflect.get(primary, "schemaVersion"), 1);
    assert.equal(Reflect.get(primary, "runID"), runID);
    assert.equal(Reflect.get(primary, "day"), day);
    const child: unknown = Reflect.get(primary, "child");
    const parent: unknown = Reflect.get(primary, "parent");
    assert.ok(typeof child === "string" && typeof parent === "string");
    assert.equal(Buffer.from(child, "base64").toString("base64"), child);
    assert.equal(Buffer.from(parent, "base64").toString("base64"), parent);
    await verifyOccurrenceVault(
      vault,
      day,
      "repaired",
      Buffer.from(child, "base64").toString("utf8"),
      Buffer.from(parent, "base64").toString("utf8"),
    );
    assert.equal(
      viewerDay(),
      day,
      "The viewer's civil day changed during the journey",
    );
    requireStableSources(sources, await fingerprints());
    const proof = launchJournal(
      await Bun.file(path.join(state, "occurrence-launches.json")).json(),
      binding,
    );
    assert.equal(
      proof.launches.length,
      3,
      "All three cold-launch identities must be retained",
    );
    assert.ok(proof.launches.every((launch) => launch.state === "closed"));
  } catch (error) {
    failures.push(error);
  }
  try {
    const journalPath = path.join(state, "occurrence-launches.json");
    const journalFile = Bun.file(journalPath);
    const journal = (await journalFile.exists())
      ? launchJournal(await journalFile.json(), binding)
      : null;
    const retired = await retireMacRun(binding, journal, evidence);
    if (journal) {
      const last = journal.launches.at(-1);
      if (last?.state === "running") {
        last.state = "closed";
        const temporary = path.join(
          state,
          `closed-owner-${crypto.randomUUID()}.json`,
        );
        await Bun.write(temporary, JSON.stringify(journal));
        await rename(temporary, journalPath);
      }
    }
    await Bun.write(
      path.join(evidence, "ownership-cleanup.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          ...binding,
          journalPresent: journal !== null,
          ...retired,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    failures.push(error);
  }
  for (const retain of [
    () =>
      cp(state, path.join(evidence, "state"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      }),
    async () => {
      if (await Bun.file(path.join(result, "Info.plist")).exists())
        await command([
          "xcrun",
          "xcresulttool",
          "export",
          "attachments",
          "--path",
          result,
          "--output-path",
          path.join(evidence, "screenshots"),
        ]);
    },
  ]) {
    try {
      await retain();
    } catch (error) {
      failures.push(error);
    }
  }
  await Bun.write(
    path.join(evidence, "run.json"),
    JSON.stringify(
      { ...receipt, status: failures.length === 0 ? "passed" : "failed" },
      null,
      2,
    ),
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `Native recurrence acceptance failed; retained ${evidence}`,
    );
  console.log(`Native recurrence acceptance passed: ${evidence}`);
}

if (import.meta.main) await runMacOccurrenceAcceptance();
