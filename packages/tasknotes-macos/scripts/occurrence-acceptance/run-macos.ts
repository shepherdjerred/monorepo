import assert from "node:assert/strict";
import { mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { boundedCommand } from "../apple-acceptance/bounded-command.ts";
import { retireMacRun } from "../apple-acceptance/native-owner.ts";
import { launchJournal } from "../apple-acceptance/retained-owner.ts";
import {
  buildMacAcceptance,
  configureMacAcceptanceTestRun,
  createMacAcceptanceState,
  macAcceptanceTestRun,
  recordMacAcceptanceOutcome,
  runMacAcceptanceCase,
  retainMacAcceptanceEvidence,
} from "../apple-acceptance/mac-journey.ts";
import {
  requireStableSources,
  sourceFingerprints,
} from "../apple-acceptance/source-provenance.ts";
import { readAcceptanceResultReports } from "../acceptance-execution.ts";
import { assertExactNativeResults } from "../acceptance-test-plan.ts";
import {
  seedOccurrenceVault,
  verifyOccurrenceVault,
  occurrenceFixture,
  viewerDay,
} from "./fixture.ts";
import { requireMacReadinessCapture } from "../apple-acceptance/mac-evidence.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
export type MacAcceptanceMode = "recurrence" | "capture-readiness";

export function macAcceptancePlan(mode: MacAcceptanceMode = "recurrence") {
  assert.ok(mode === "recurrence" || mode === "capture-readiness");
  const readiness = mode === "capture-readiness";
  const test = readiness
    ? "testOwnedSyntheticWindowCapture"
    : "testGenerationRepairUndoAndColdRelaunch";
  const suite: "CaptureReadinessUITests" | "OccurrenceVaultUITests" = readiness
    ? "CaptureReadinessUITests"
    : "OccurrenceVaultUITests";
  return {
    test,
    suite,
    selector: `TaskNotesAcceptanceUITests/${suite}/${test}`,
    kind: readiness
      ? "native-capture-readiness-macos"
      : "native-occurrence-macos",
    result: readiness ? "CaptureReadiness.xcresult" : "Occurrence.xcresult",
    launches: readiness ? 1 : 3,
    successStatus: readiness ? ("capture-ready" as const) : ("passed" as const),
  };
}

export function occurrenceCommand(root: string, evidence: string) {
  return (argv: string[], capture = false, cwd = root) =>
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
}

/** Compile first, then run one owned window journey without opening a folder picker. */
export async function runMacOccurrenceAcceptance(): Promise<void> {
  assert.equal(process.platform, "darwin");
  assert.deepEqual(
    Bun.argv.slice(2),
    ["--host-ui"],
    "Foreground native testing requires explicit --host-ui",
  );
  const runID = crypto.randomUUID();
  const evidence = path.join(
    packageRoot,
    ".build/occurrence-acceptance",
    runID,
  );
  const derived = path.join(evidence, "macos");
  const command = occurrenceCommand(packageRoot, evidence);
  const fingerprints = () =>
    sourceFingerprints(path.resolve(packageRoot, "../.."), (argv) =>
      command(argv, true, path.resolve(packageRoot, "../..")),
    );
  await mkdir(evidence, { recursive: true });
  const sources = await fingerprints();
  await buildMacAcceptance(
    derived,
    command,
    Bun.env["TASKNOTES_UITEST_IDENTITY"],
  );
  await runPreparedMacOccurrence({
    packageRoot,
    runID,
    sources,
    verifyInputs: async () =>
      requireStableSources(sources, await fingerprints()),
  });
}

/** Host and VM transports execute exactly the same fixture, UI and retained-owner gates. */
export async function runPreparedMacOccurrence(run: {
  packageRoot: string;
  runID: string;
  sources: Record<string, string>;
  verifyInputs: () => Promise<void>;
  provenance?: Record<string, unknown>;
  mode?: MacAcceptanceMode;
  runnerBundlePath?: string;
}): Promise<void> {
  const { packageRoot, runID, sources } = run;
  const mode = run.mode ?? "recurrence";
  const plan = macAcceptancePlan(mode);
  const evidence = path.join(
    packageRoot,
    ".build/occurrence-acceptance",
    runID,
  );
  const derived = path.join(evidence, "macos");
  const command = occurrenceCommand(packageRoot, evidence);
  await run.verifyInputs();
  const state = path.join(
    homedir(),
    "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data/Library/Application Support/FacetAcceptance",
    runID,
  );
  const descriptor = path.join(state, "acceptance.json");
  const vault = path.join(state, "Native acceptance");
  const result = path.join(evidence, plan.result);
  const executable = path.join(
    derived,
    "Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
  );
  const binding = { runID, descriptor, executable };
  await retireMacRun(binding, null, evidence);
  const day = viewerDay();
  await createMacAcceptanceState(state, descriptor, runID);
  await seedOccurrenceVault(vault, day);
  const testRun = await macAcceptanceTestRun(derived);
  await configureMacAcceptanceTestRun(
    testRun,
    {
      FACET_E2E_DESCRIPTOR: descriptor,
      FACET_E2E_RUN_ID: runID,
      FACET_OCCURRENCE_DAY: day,
    },
    command,
    run.runnerBundlePath,
  );
  const receipt = {
    ...run.provenance,
    schemaVersion: 1,
    runID,
    day,
    kind: plan.kind,
    selector: plan.selector,
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
    await runMacAcceptanceCase(
      {
        evidence,
        testRun,
        result,
        selector: plan.selector,
        maximumSeconds: 180,
      },
      command,
    );
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
      [plan.test],
      { target: "TaskNotesAcceptanceUITests", suite: plan.suite },
    );
    if (mode === "capture-readiness") {
      for (const [relative, original] of Object.entries(occurrenceFixture(day)))
        assert.equal(
          await Bun.file(path.join(vault, relative)).text(),
          original,
          `Capture readiness changed seed: ${relative}`,
        );
    } else {
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
    }
    assert.equal(
      viewerDay(),
      day,
      "The viewer's civil day changed during the journey",
    );
    await run.verifyInputs();
    const proof = launchJournal(
      await Bun.file(path.join(state, "occurrence-launches.json")).json(),
      binding,
    );
    assert.equal(
      proof.launches.length,
      plan.launches,
      "The selected journey must retain every exact launch identity",
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
  failures.push(
    ...(await retainMacAcceptanceEvidence(state, result, evidence, command)),
  );
  if (mode === "capture-readiness" && failures.length === 0) {
    try {
      await requireMacReadinessCapture(evidence);
    } catch (error) {
      failures.push(error);
    }
  }
  await recordMacAcceptanceOutcome(
    receipt,
    failures,
    evidence,
    `Native ${mode} acceptance failed; retained ${evidence}`,
    plan.successStatus,
  );
  console.log(`Native ${mode} acceptance ${plan.successStatus}: ${evidence}`);
}

if (import.meta.main) await runMacOccurrenceAcceptance();
