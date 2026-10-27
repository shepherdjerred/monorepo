import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { boundedCommand } from "tasknotes-macos/scripts/apple-acceptance/bounded-command.ts";
import {
  macFileSHA,
  readMacArtifact,
  verifyMacArtifact,
} from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";
import {
  readOwnedMacVMJSON,
  requireMacVMCaptureReady,
} from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { installMacVMRunner } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-runner.ts";
import {
  guestLivePaths,
  ownedLiveDirectory,
  readLiveConfig,
} from "./config.ts";
import { retireGuestProcess } from "./process.ts";

export async function guestHardwarePreflight(): Promise<void> {
  assert.equal(process.platform, "darwin");
  assert.ok(process.getuid && process.getuid() > 0);
  const result = spawnSync("/usr/sbin/sysctl", ["-n", "kern.hv_vmm_present"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4096,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout.trim(),
    "1",
    "Guest execution is forbidden on the host",
  );
  const consoleMetadata = await stat("/dev/console");
  assert.equal(consoleMetadata.uid, process.getuid());
}
export async function createGuestRuntime(
  exportRoot: string,
  expectedConfigSHA: string,
) {
  await guestHardwarePreflight();
  const config = await readLiveConfig(exportRoot, expectedConfigSHA),
    paths = guestLivePaths(config);
  const artifact = readMacArtifact(
    await readOwnedMacVMJSON(path.join(exportRoot, "artifact.json")),
  );
  assert.equal(artifact.sourceHead, config.sourceHead);
  assert.equal(artifact.runID, config.buildID);
  assert.equal(artifact.packageRoot, config.packageRoot);
  Bun.env["DEVELOPER_DIR"] = "/Applications/Xcode-beta.app/Contents/Developer";
  const command = (argv: string[], capture = false) =>
    boundedCommand(argv, {
      cwd: paths.evidenceDirectory,
      logs: path.join(paths.evidenceDirectory, "commands"),
      capture,
      timeoutMS: 60_000,
    });
  const verify = async () => {
    assert.deepEqual(
      await readLiveConfig(exportRoot, expectedConfigSHA),
      config,
    );
    for (const directory of [
      paths.evidenceDirectory,
      paths.stateDirectory,
      paths.referenceDirectory,
    ])
      await ownedLiveDirectory(directory);
    assert.equal(
      await command(["xcodebuild", "-version"], true),
      artifact.xcodeVersion,
    );
    const exportChecks = path.join(
      paths.evidenceDirectory,
      "export-verification",
    );
    await mkdir(exportChecks, { recursive: true, mode: 0o700 });
    await verifyMacArtifact(
      artifact,
      path.join(exportRoot, "products"),
      command,
      exportChecks,
    );
    await verifyMacArtifact(artifact, paths.products, command);
    const archive = path.join(
      "/Volumes/My Shared Files/exports",
      `official-obsidian-${config.officialApp.exportID}`,
      `Obsidian-${config.officialApp.version}.zip`,
    );
    assert.equal(await macFileSHA(archive), config.officialApp.archiveSHA256);
    await command([
      "codesign",
      "--verify",
      "--deep",
      "--strict",
      paths.officialApp,
    ]);
    assert.equal(
      await command(
        [
          "/usr/libexec/PlistBuddy",
          "-c",
          "Print :CFBundleShortVersionString",
          path.join(paths.officialApp, "Contents/Info.plist"),
        ],
        true,
      ),
      config.officialApp.version,
    );
  };
  const withRunner = async <T>(
    action: (runner: {
      bundlePath: string;
      installationID: string;
    }) => Promise<T>,
    requireReady = true,
  ) => {
    const runner = await installMacVMRunner(
      artifact,
      path.join(exportRoot, "products"),
      config.runID,
      command,
    );
    try {
      await runner.verify();
      const ready = {
        payloadSHA256: config.payloadSHA256,
        installationID: runner.installationID,
        bundlePath: runner.bundlePath,
        sourceHead: config.sourceHead,
      };
      if (requireReady)
        requireMacVMCaptureReady(
          await readOwnedMacVMJSON(
            path.join(
              os.homedir(),
              "Library/Application Support/FacetAcceptanceHarness/readiness",
              `${config.payloadSHA256}-${runner.installationID}.json`,
            ),
            4096,
          ),
          ready,
        );
      const result = await action(runner);
      await runner.verify();
      return result;
    } finally {
      await runner.release();
    }
  };
  const retire = () =>
    retireGuestProcess(
      path.join(paths.app, "Contents/MacOS/FacetAcceptance"),
      exportRoot,
      paths.evidenceDirectory,
    );
  return {
    config,
    paths,
    artifact,
    exportRoot,
    expectedConfigSHA,
    command,
    verify,
    withRunner,
    retire,
  };
}
export type GuestRuntime = Awaited<ReturnType<typeof createGuestRuntime>>;
