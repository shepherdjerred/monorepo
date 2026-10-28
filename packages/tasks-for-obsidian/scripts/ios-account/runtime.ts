import assert from "node:assert/strict";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  assertOwnedSimulator,
  clientState,
  iosBundle,
  packageRoot,
  runDirectory,
  type Manifest,
} from "../apple-sync-live/model";
import { command, descriptor } from "../apple-sync-live/platform";
import { fingerprintApp } from "../apple-sync-live/prepare";
import { configureIosJourneyTests } from "../native-acceptance/selected-tests";
import type { AccountIdentity } from "./contract";
import { boundedCommand } from "tasknotes-macos/scripts/apple-acceptance/bounded-command.ts";
import {
  inputArtifactDirectory,
  inputBundle,
  inspectInputOwner,
  type InputArtifacts,
  type ProcessLifetime,
} from "./app-input-artifacts";

export const privateAccountSelector =
  "AccountInputUITests/testPrivateAccountInput";
const runnerBundleID = iosBundle + ".UITests.xctrunner";
const runnerExecutableName = "TasksForObsidianUITests-Runner";

export async function prepareAccountInvocation(
  manifest: Manifest,
  sessionID: string,
  appBootstrap: {
    FACET_E2E_ACCOUNT_SOCKET: string;
    FACET_E2E_ACCOUNT_HELPER_PID: string;
    FACET_E2E_ACCOUNT_OPERATION: "probe" | "credentials";
  },
  originalProfileID?: string,
) {
  clientState(manifest, "ios");
  assert.ok(manifest.simulator !== null);
  const device = manifest.simulator.id;
  assertOwnedSimulator(
    manifest.runID,
    manifest.simulator,
    JSON.parse(await command(["xcrun", "simctl", "list", "devices", "--json"])),
  );
  const products = path.join(
    runDirectory(manifest.runID),
    "ios/Build/Products",
  );
  const [name] = z
    .tuple([z.string()])
    .parse([...new Bun.Glob("*.xctestrun").scanSync({ cwd: products })]);
  const testRun = path.join(products, name);
  const runnerApp = path.join(
    products,
    "Debug-iphonesimulator/TasksForObsidianUITests-Runner.app",
  );
  const runnerFiles = await fingerprintApp(runnerApp);
  assert.ok(Object.keys(runnerFiles).length > 0);
  await configureIosJourneyTests(
    testRun,
    {
      FACET_E2E_SIMULATOR: device,
      FACET_E2E_RUN_ID: manifest.runID,
      FACET_E2E_ACCOUNT_SESSION: sessionID,
      ...appBootstrap,
      FACET_E2E_DESCRIPTOR: "@documents/acceptance.json",
      FACET_E2E_DESCRIPTOR_JSON: JSON.stringify(
        descriptor(manifest, "ios", manifest.allowedRemoteVaultID),
      ),
      ...(originalProfileID === undefined
        ? {}
        : { FACET_E2E_ACCOUNT_PROFILE_ID: originalProfileID }),
    },
    (argv) => command(argv),
  );
  await command([
    "plutil",
    "-replace",
    "TasksForObsidianUITests.UserAttachmentLifetime",
    "-string",
    "keepNever",
    testRun,
  ]);
  return {
    testRun,
    device,
    runnerApp,
    runnerFiles,
    identity: {
      sessionID,
      runID: manifest.runID.toLowerCase(),
      deviceID: device.toLowerCase(),
    } satisfies AccountIdentity,
  };
}

/** Read-only readiness polling can follow Xcode's owned Runner-container relocation. */
export async function waitForPrivateSocket(
  device: string,
  sessionID: string,
  aborted: () => boolean,
) {
  const deadline = Date.now() + 90_000;
  while (!aborted() && Date.now() < deadline) {
    try {
      const container = await command(
        [
          "xcrun",
          "simctl",
          "get_app_container",
          device,
          runnerBundleID,
          "data",
        ],
        packageRoot,
        {},
        { timeoutMS: 5000 },
      );
      assert.ok(
        path.isAbsolute(container) && (await realpath(container)) === container,
      );
      const directory = path.join(
        container,
        "tmp/FacetAccountInput",
        sessionID,
      );
      const metadata = await lstat(
        path.join(directory, `facet-account-${sessionID}.sock`),
      );
      if (metadata.isSocket()) return directory;
    } catch {
      // The native runner has not created its owned socket yet. No UI action is repeated.
    }
    await Bun.sleep(100);
  }
  throw new Error("Owned iOS private input socket did not become available");
}

export function runnerOwnerValidator(
  device: string,
  expectedHash: string,
  binding: {
    runID: string;
    artifacts: InputArtifacts;
    files: Record<string, string>;
  },
) {
  let lifetime: ProcessLifetime | undefined;
  return async (ready: { runnerPID: number }) => {
    const app = await command(
      ["xcrun", "simctl", "get_app_container", device, runnerBundleID, "app"],
      packageRoot,
      {},
      { timeoutMS: 5000 },
    );
    assert.equal(await realpath(app), app);
    const executable = path.join(app, runnerExecutableName);
    const metadata = await lstat(executable);
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === process.getuid?.(),
    );
    const actualHash = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(executable).bytes())
      .digest("hex");
    assert.equal(
      actualHash,
      expectedHash,
      "Installed iOS input runner differs from its exact artifact",
    );
    assert.deepEqual(
      await inputBundle(app),
      binding.files,
      "Installed iOS Runner bundle differs from its exact artifact",
    );
    lifetime = await inspectInputOwner(
      inputArtifactDirectory(binding.runID),
      binding.artifacts,
      ready.runnerPID,
      { executable, expected: lifetime },
    );
  };
}

export function privateNativeCommand(evidence: string) {
  return (argv: string[], capture = false) =>
    boundedCommand(argv, {
      cwd: packageRoot,
      logs: path.join(evidence, "commands"),
      timeoutMS: 180_000,
      capture,
    });
}
