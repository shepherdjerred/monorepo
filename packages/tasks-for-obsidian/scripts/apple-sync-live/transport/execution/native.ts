import assert from "node:assert/strict";
import { retainNativeReports } from "./native-reports.ts";
import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GuestRequest } from "../contract.ts";
import type { ExecutionOperation, ExecutionResult } from "./contract.ts";
import type { GuestRuntime } from "./runtime.ts";
import { boundedCommand } from "tasknotes-macos/scripts/apple-acceptance/bounded-command.ts";
import { configureMacAcceptanceTestRun } from "tasknotes-macos/scripts/apple-acceptance/mac-journey.ts";
import { requireUnlockedMac } from "tasknotes-macos/scripts/apple-acceptance/mac-session.ts";
import { assertExactNativeJourney } from "../../native-evidence.ts";

export function requireNativeLabel(
  operation: Extract<ExecutionOperation, { kind: "native" }>,
  round: number,
): void {
  const labels: Record<string, string[]> = {
    "LiveSyncVaultUITests/testInitialDownloadUsesTaskNotesConfiguration": [
      "initial-configuration-macos",
    ],
    "LiveSyncVaultUITests/testCaptureEditCompleteUncompleteAndColdRelaunch": [
      `capture-macos-${String(round)}`,
    ],
    "LiveSyncVaultUITests/testOfflineCaptureEditAndColdRelaunchRetainPendingChanges":
      ["offline-macos", "lifecycle-macos-pending"],
    "LiveSyncConflictUITests/testEditOwnedTaskWhileOffline": [
      "conflict-macos-edit",
    ],
    "LiveSyncConflictUITests/testPreviewAndKeepBothVersions": [
      "conflict-macos-resolve",
    ],
    "LiveSyncLifecycleUITests/testSignOutPreservesPendingTaskAndColdReplica": [
      "lifecycle-macos-signedout",
    ],
    "LiveSyncLifecycleUITests/testReauthorizedReplicaRetainsTaskAndColdRelaunch":
      ["lifecycle-macos-reauthorized"],
  };
  assert.ok(labels[operation.selector]?.includes(operation.label));
  if (operation.extra.FACET_E2E_ROUND !== undefined)
    assert.equal(operation.extra.FACET_E2E_ROUND, String(round));
}

/** Exactly one existing live test, same signed Runner and strict result/owner gates. */
export async function runGuestNative(
  runtime: GuestRuntime,
  operation: Extract<ExecutionOperation, { kind: "native" }>,
  request: GuestRequest,
): Promise<ExecutionResult> {
  requireNativeLabel(operation, request.binding.round);
  const remoteVaultID = request.binding.allowedRemoteVaultID;
  assert.ok(remoteVaultID !== null);
  const relative = `journeys/round-${String(request.binding.round)}/${operation.label}`,
    evidence = path.join(runtime.paths.evidenceDirectory, relative);
  await mkdir(path.dirname(evidence), { recursive: true, mode: 0o700 });
  await mkdir(evidence, { recursive: false, mode: 0o700 });
  const deadline = Date.now() + operation.timeoutMS;
  const command = (argv: string[], capture = false) => {
    assert.ok(
      Date.now() < deadline,
      "Native journey exceeded its deadline before command start",
    );
    return boundedCommand(argv, {
      cwd: runtime.paths.packageRoot,
      logs: path.join(evidence, "commands"),
      capture,
      timeoutMS: Math.max(1, deadline - Date.now()),
    });
  };
  const plans = Object.keys(runtime.artifact.files).filter((file) =>
    file.endsWith(".xctestrun"),
  );
  assert.equal(plans.length, 1);
  const plan = plans[0];
  assert.ok(plan);
  const testRun = path.join(runtime.paths.products, plan),
    metadata = await lstat(testRun);
  assert.ok(
    metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.(),
  );
  await runtime.retire();
  await copyFile(path.join(runtime.exportRoot, "products", plan), testRun);
  const resultBundle = path.join(evidence, "Journey.xcresult"),
    failures: unknown[] = [];
  try {
    await runtime.withRunner(async (runner) => {
      const original = z
        .record(z.string(), z.string())
        .parse(
          JSON.parse(
            await command(
              [
                "plutil",
                "-extract",
                "TaskNotesAcceptanceUITests.EnvironmentVariables",
                "json",
                "-o",
                "-",
                testRun,
              ],
              true,
            ),
          ),
        );
      delete original["FACET_E2E_SIMULATOR"];
      const descriptor = {
        schemaVersion: 1,
        runID: runtime.config.runID,
        stateDirectory: runtime.paths.stateDirectory,
        allowedRemoteVaultID: request.binding.allowedRemoteVaultID,
      };
      const environment: Record<string, string> = {
        ...original,
        ...z.record(z.string(), z.string()).parse(operation.extra),
        FACET_E2E_RUN_ID: runtime.config.runID,
        FACET_E2E_DESCRIPTOR: runtime.paths.descriptor,
        FACET_E2E_DESCRIPTOR_JSON: JSON.stringify(descriptor),
        FACET_E2E_ROUND: String(request.binding.round),
        FACET_E2E_VAULT_ID: remoteVaultID,
        FACET_E2E_REMOTE_VAULT_ID: remoteVaultID,
        FACET_E2E_APP_BUNDLE_ID: "red.sjer.tasknotes.mac.acceptance",
      };
      await configureMacAcceptanceTestRun(
        testRun,
        environment,
        command,
        runner.bundlePath,
      );
      await requireUnlockedMac(
        path.join(evidence, "session-preflight.json"),
        command,
      );
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
          resultBundle,
          "-only-testing:TaskNotesAcceptanceUITests/" + operation.selector,
          "-collect-test-diagnostics",
          "never",
          "-test-timeouts-enabled",
          "YES",
          "-maximum-test-execution-time-allowance",
          String(Math.ceil(operation.timeoutMS / 1000)),
        ]);
      } catch (error) {
        failures.push(error);
      }
      const reports = await retainNativeReports({
        resultBundle,
        evidence,
        command: runtime.command,
        failures,
      });
      assertExactNativeJourney(
        reports["summary"],
        reports["tests"],
        "TaskNotesAcceptanceUITests",
        operation.selector,
      );
      await writeFile(
        path.join(evidence, "selected-test.json"),
        JSON.stringify({
          schemaVersion: 1,
          runID: runtime.config.runID,
          round: request.binding.round,
          target: "TaskNotesAcceptanceUITests",
          selector: operation.selector,
          outcome: "passed",
        }),
        { flag: "wx", mode: 0o600 },
      );
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    const retired = await runtime.retire();
    await writeFile(
      path.join(evidence, "ownership-cleanup.json"),
      JSON.stringify({
        schemaVersion: 1,
        runID: runtime.config.runID,
        ...retired,
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    if (await Bun.file(path.join(resultBundle, "Info.plist")).exists())
      await runtime.command([
        "xcrun",
        "xcresulttool",
        "export",
        "attachments",
        "--path",
        resultBundle,
        "--output-path",
        path.join(evidence, "attachments"),
      ]);
  } catch (error) {
    failures.push(error);
  }
  await runtime.verify();
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Guest native journey failed; retained private guest evidence",
    );
  const files = [
    "summary.json",
    "tests.json",
    "selected-test.json",
    "ownership-cleanup.json",
  ].map((name) => `${relative}/${name}`);
  for await (const name of new Bun.Glob("*").scan({
    cwd: path.join(evidence, "attachments"),
    onlyFiles: true,
  }))
    if (
      name === "manifest.json" ||
      /^[A-Fa-f0-9-]{36}\.(?:png|json)$/u.test(name)
    )
      files.push(`${relative}/attachments/${name}`);
  assert.ok(
    files.some((name) => name.endsWith(".png")),
    "Native acceptance requires actual app-only screenshot evidence",
  );
  return {
    kind: "native",
    selector: operation.selector,
    label: operation.label,
    evidenceDirectory: relative,
    files,
  };
}
