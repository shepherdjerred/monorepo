import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { boundedCommand } from "../apple-acceptance/bounded-command.ts";
import { retireMacRun } from "../apple-acceptance/native-owner.ts";
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
  dependencyTest,
  seedDependencyVault,
  verifyDependencyVault,
} from "./fixture.ts";

export async function runMacDependencyAcceptance(): Promise<void> {
  assert.equal(process.platform, "darwin");
  assert.equal(Bun.argv.length, 2, "The dependency runner takes no arguments");
  const packageRoot = path.resolve(import.meta.dir, "../..");
  const workspace = path.resolve(packageRoot, "../..");
  const runID = crypto.randomUUID();
  const evidence = path.join(
    packageRoot,
    ".build/dependency-acceptance",
    runID,
  );
  const derived = path.join(packageRoot, ".build/acceptance-xcode");
  const state = path.join(
    homedir(),
    "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data/Library/Application Support/FacetAcceptance",
    runID,
  );
  const descriptor = path.join(state, "acceptance.json");
  const vault = path.join(state, "Native acceptance");
  const result = path.join(evidence, "Dependency.xcresult");
  const executable = path.join(
    derived,
    "Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
  );
  const binding = { runID, descriptor, executable };
  const command = (argv: string[], capture = false, cwd = packageRoot) =>
    boundedCommand(argv, {
      cwd,
      capture,
      logs: path.join(evidence, "commands"),
      timeoutMS: argv.includes("build-for-testing")
        ? 600_000
        : argv.includes("test-without-building")
          ? 180_000
          : 60_000,
    });
  const fingerprints = () =>
    sourceFingerprints(workspace, (argv) => command(argv, true, workspace));
  await mkdir(evidence, { recursive: true });
  const sources = await fingerprints();
  await buildMacAcceptance(
    derived,
    command,
    Bun.env["TASKNOTES_UITEST_IDENTITY"],
  );
  requireStableSources(sources, await fingerprints());
  await retireMacRun(binding, null, evidence);
  await createMacAcceptanceState(state, descriptor, runID);
  await seedDependencyVault(vault);
  const testRun = await macAcceptanceTestRun(derived);
  await configureMacAcceptanceTestRun(
    testRun,
    { FACET_E2E_DESCRIPTOR: descriptor, FACET_E2E_RUN_ID: runID },
    command,
  );
  const receipt = {
    schemaVersion: 1,
    runID,
    kind: "native-dependency-editor-macos",
    sources,
    selector: `TaskNotesAcceptanceUITests/DependencyEditorUITests/${dependencyTest}`,
    remoteVaultAuthorized: false,
    accountEntryCaptured: false,
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
        selector: receipt.selector,
        maximumSeconds: 120,
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
      [dependencyTest],
      {
        target: "TaskNotesAcceptanceUITests",
        suite: "DependencyEditorUITests",
      },
    );
    const hashes = await verifyDependencyVault(vault, true);
    await Bun.write(
      path.join(evidence, "vault.json"),
      JSON.stringify(hashes, null, 2),
    );
    requireStableSources(sources, await fingerprints());
  } catch (error) {
    failures.push(error);
  }
  try {
    const cleanup = await retireMacRun(binding, null, evidence);
    await Bun.write(
      path.join(evidence, "ownership-cleanup.json"),
      JSON.stringify(cleanup, null, 2),
    );
  } catch (error) {
    failures.push(error);
  }
  failures.push(
    ...(await retainMacAcceptanceEvidence(state, result, evidence, command)),
  );
  await recordMacAcceptanceOutcome(
    receipt,
    failures,
    evidence,
    `Native dependency editor proof failed; retained ${evidence}`,
  );
  console.log(`Native dependency editor proof passed: ${evidence}`);
}

if (import.meta.main) await runMacDependencyAcceptance();
