import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  packageRoot,
  macBundle,
  uuid,
  type Client,
  type Manifest,
  StatusSchema,
  validate,
  settledProfile,
  verifyReplica,
  assertOwnedSimulator,
  runDirectory,
  atomicJSON,
} from "./model";
import {
  command,
  readManifest,
  save,
  descriptor,
  statuses,
  launch,
} from "./platform";
import { assertExactNativeJourney } from "./native-evidence";

export async function runNativeTest(
  manifest: Manifest,
  client: Client,
  selector: string,
  options: { label: string; extra?: Record<string, string> },
) {
  const { label, extra = {} } = options;
  const deadline = Date.now() + 600_000;
  const runCommand = (argv: string[], logFile?: string) =>
    command(
      argv,
      packageRoot,
      {},
      {
        ...(logFile === undefined ? {} : { logFile }),
        timeoutMS: Math.max(1, deadline - Date.now()),
      },
    );
  if (
    manifest.clients === null ||
    manifest.simulator === null ||
    manifest.allowedRemoteVaultID === null
  )
    throw new Error("Native live journeys require a bound, authenticated run");
  assertOwnedSimulator(
    manifest.runID,
    manifest.simulator,
    JSON.parse(
      await runCommand(["xcrun", "simctl", "list", "devices", "--json"]),
    ),
  );
  const directory = runDirectory(manifest.runID);
  const products = path.join(directory, client, "Build/Products");
  const testRun = path.join(
    products,
    z
      .tuple([z.string()])
      .parse([...new Bun.Glob("*.xctestrun").scanSync({ cwd: products })])[0],
  );
  const configuration = z
    .record(z.string(), z.unknown())
    .parse(
      JSON.parse(
        await runCommand(["plutil", "-convert", "json", "-o", "-", testRun]),
      ),
    );
  z.object({ FormatVersion: z.literal(1) }).parse(
    configuration["__xctestrun_metadata__"],
  );
  const target =
    client === "ios" ? "TasksForObsidianUITests" : "TaskNotesAcceptanceUITests";
  const existing = z
    .object({ EnvironmentVariables: z.record(z.string(), z.string()) })
    .parse(configuration[target]);
  const environment = {
    ...existing.EnvironmentVariables,
    FACET_E2E_RUN_ID: manifest.runID,
    FACET_E2E_DESCRIPTOR:
      client === "ios"
        ? "@documents/acceptance.json"
        : manifest.clients.macos.descriptor,
    FACET_E2E_DESCRIPTOR_JSON: JSON.stringify(
      descriptor(manifest, client, manifest.allowedRemoteVaultID),
    ),
    FACET_E2E_SIMULATOR: manifest.simulator.id,
    FACET_E2E_VAULT_ID: manifest.allowedRemoteVaultID,
    FACET_E2E_REMOTE_VAULT_ID: manifest.allowedRemoteVaultID,
    FACET_E2E_APP_BUNDLE_ID: macBundle,
    ...extra,
  };
  await runCommand([
    "plutil",
    "-replace",
    `${target}.EnvironmentVariables`,
    "-json",
    JSON.stringify(environment),
    testRun,
  ]);
  await runCommand([
    "plutil",
    "-replace",
    `${target}.SystemAttachmentLifetime`,
    "-string",
    "keepAlways",
    testRun,
  ]);
  await runCommand([
    "plutil",
    "-replace",
    `${target}.UserAttachmentLifetime`,
    "-string",
    "keepAlways",
    testRun,
  ]);
  const evidence = path.join(
    directory,
    "journeys",
    `round-${String(manifest.round)}`,
    label,
  );
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const resultBundle = path.join(evidence, "Journey.xcresult");
  const failures: unknown[] = [];
  try {
    await runCommand(
      [
        "xcodebuild",
        "test-without-building",
        "-xctestrun",
        testRun,
        "-destination",
        client === "ios"
          ? `platform=iOS Simulator,id=${manifest.simulator.id}`
          : "platform=macOS",
        "-parallel-testing-enabled",
        "NO",
        "-resultBundlePath",
        resultBundle,
        "-only-testing:" + target + "/" + selector,
        "-collect-test-diagnostics",
        "never",
      ],
      path.join(evidence, "xcodebuild.log"),
    );
    const summary: unknown = JSON.parse(
      await runCommand([
        "xcrun",
        "xcresulttool",
        "get",
        "test-results",
        "summary",
        "--compact",
        "--path",
        resultBundle,
      ]),
    );
    const tests: unknown = JSON.parse(
      await runCommand([
        "xcrun",
        "xcresulttool",
        "get",
        "test-results",
        "tests",
        "--compact",
        "--path",
        resultBundle,
      ]),
    );
    assertExactNativeJourney(summary, tests, target, selector);
    await atomicJSON(path.join(evidence, "selected-test.json"), {
      schemaVersion: 1,
      runID: manifest.runID,
      round: manifest.round,
      target,
      selector,
      outcome: "passed",
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    if (await Bun.file(path.join(resultBundle, "Info.plist")).exists())
      await command(
        [
          "xcrun",
          "xcresulttool",
          "export",
          "attachments",
          "--path",
          resultBundle,
          "--output-path",
          path.join(evidence, "attachments"),
        ],
        packageRoot,
        {},
        { timeoutMS: 10_000 },
      );
    Object.assign(manifest, await readManifest(manifest.runID, 10_000));
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0)
    throw new AggregateError(failures, `Native live journey failed: ${label}`);
}

export async function waitForConvergence(
  manifest: Manifest,
  expected: Manifest["reference"],
  milliseconds = 120_000,
) {
  if (manifest.allowedRemoteVaultID === null)
    throw new Error("The acceptance vault is not bound");
  const deadline = Date.now() + milliseconds;
  let lastFailure = "No acceptance status";
  while (Date.now() < deadline) {
    try {
      Object.assign(
        manifest,
        await readManifest(manifest.runID, Math.max(1, deadline - Date.now())),
      );
      if (manifest.clients === null) throw new Error("Apps are not prepared");
      const current = await statuses(manifest);
      for (const { client, value } of current) {
        const profile = settledProfile(
          value,
          manifest.runID,
          manifest.allowedRemoteVaultID,
          Date.now(),
        );
        await verifyReplica(
          path.join(
            manifest.clients[client].stateDirectory,
            "replicas",
            profile.profileID,
          ),
          expected,
        );
      }
      await verifyReplica(
        path.join(runDirectory(manifest.runID), "reference-vault"),
        expected,
      );
      return current;
    } catch (error) {
      lastFailure =
        error instanceof Error ? error.message : "Unknown acceptance failure";
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `Live convergence deadline exceeded: ${lastFailure}. Failed run retained; no automatic retry.`,
  );
}

export async function ownedProfile(
  manifest: Manifest,
  client: Client,
  allowSignedOut = false,
  timeoutMS = 120_000,
) {
  Object.assign(manifest, await readManifest(manifest.runID, timeoutMS));
  const current = await statuses(manifest);
  const entry = current.find((item) => item.client === client);
  if (entry === undefined) throw new Error("Missing acceptance client status");
  validate("status", entry.value);
  const status = StatusSchema.parse(entry.value);
  const age = Date.now() - Date.parse(status.capturedAt);
  if (status.runID.toLowerCase() !== manifest.runID)
    throw new Error("Wrong-run acceptance status");
  if (age < -1000 || age > 5000) throw new Error("Stale acceptance status");
  const profile = z
    .tuple([StatusSchema.shape.profiles.element])
    .parse(status.profiles)[0];
  if (
    profile.profileKind !== "obsidian_sync" ||
    profile.durable?.profileId !== profile.profileID ||
    (profile.remoteVaultID !== manifest.allowedRemoteVaultID &&
      !(allowSignedOut && profile.remoteVaultID === null))
  )
    throw new Error("Wrong bound acceptance profile");
  return profile;
}

export async function waitForProfile(
  manifest: Manifest,
  client: Client,
  expectedPhase: string,
  allowSignedOut = false,
) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const profile = await ownedProfile(
        manifest,
        client,
        allowSignedOut,
        Math.max(1, deadline - Date.now()),
      );
      if (profile.phase === expectedPhase) return profile;
      if (profile.phase === "failed")
        throw new Error(
          "Acceptance profile failed before reaching its expected phase",
        );
    } catch (error) {
      if (
        !(
          error instanceof Error && error.message === "Stale acceptance status"
        ) &&
        !z.object({ code: z.literal("ENOENT") }).safeParse(error).success
      )
        throw error;
    }
    await Bun.sleep(250);
  }
  throw new Error(
    `Acceptance phase deadline exceeded: ${client} ${expectedPhase}`,
  );
}

export function replicaDirectory(
  manifest: Manifest,
  client: Client,
  profileID: string,
) {
  if (manifest.clients === null) throw new Error("Apps are not prepared");
  uuid.parse(profileID);
  return path.join(
    manifest.clients[client].stateDirectory,
    "replicas",
    profileID,
  );
}

export async function control(
  manifest: Manifest,
  client: Client,
  kind: "refresh" | "interrupt" | "resume",
  profileID?: string,
) {
  if (manifest.clients === null || manifest.allowedRemoteVaultID === null)
    throw new Error("Run is not bound");
  const directory = path.join(
    manifest.clients[client].stateDirectory,
    "control",
  );
  const commandID = crypto.randomUUID();
  const message = {
    schemaVersion: 1,
    runID: manifest.runID,
    commandID,
    kind,
    ...(profileID === undefined ? {} : { profileID }),
  };
  validate("command", message);
  await atomicJSON(path.join(directory, "command.json"), message);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const resultFile = Bun.file(path.join(directory, "result.json"));
    if (await resultFile.exists()) {
      const value: unknown = await resultFile.json();
      validate("result", value);
      const result = z
        .object({
          runID: uuid,
          commandID: uuid,
          outcome: z.enum(["applied", "rejected"]),
        })
        .parse(value);
      if (result.runID.toLowerCase() !== manifest.runID)
        throw new Error("Wrong control acknowledgement run");
      if (result.commandID === commandID) {
        if (result.outcome !== "applied")
          throw new Error("Acceptance control rejected the command");
        console.log(`${client}: ${kind} acknowledged`);
        return;
      }
    }
    await Bun.sleep(250);
  }
  throw new Error("Acceptance control acknowledgement deadline exceeded");
}

export async function verify(manifest: Manifest) {
  if (manifest.clients === null || manifest.allowedRemoteVaultID === null)
    throw new Error("Bind the test vault before verification");
  if (manifest.cases["official-reference"] !== "pass")
    throw new Error(
      "Run seal-reference after installing and enabling official TaskNotes 4.13.8",
    );
  await launch(manifest);
  const directory = runDirectory(manifest.runID);
  const deadline =
    Date.now() +
    (manifest.round === 1 && manifest.cases["initial-download"] !== "pass"
      ? 180_000
      : 120_000);
  let lastFailure = "No acceptance status";
  while (Date.now() < deadline) {
    try {
      const current = await statuses(manifest);
      for (const { client, value } of current) {
        const profile = settledProfile(
          value,
          manifest.runID,
          manifest.allowedRemoteVaultID,
          Date.now(),
        );
        await verifyReplica(
          path.join(
            manifest.clients[client].stateDirectory,
            "replicas",
            profile.profileID,
          ),
          manifest.reference,
        );
      }
      await verifyReplica(
        path.join(directory, "reference-vault"),
        manifest.reference,
      );
      manifest.cases["initial-download"] = "pass";
      manifest.stage = "initial-verified";
      await save(manifest);
      // Retain only schema-checked, content-free projections after credential entry.
      await atomicJSON(path.join(directory, "initial-download.json"), {
        schemaVersion: 1,
        runID: manifest.runID,
        round: manifest.round,
        capturedAt: new Date().toISOString(),
        clients: current,
      });
      console.log(
        "Initial convergence passed: both real replicas and the official reference folder match exact synthetic file hashes and paths. Other acceptance cases remain pending.",
      );
      return;
    } catch (error) {
      lastFailure =
        error instanceof Error ? error.message : "Unknown acceptance failure";
    }
    await Bun.sleep(500);
  }
  manifest.cases["initial-download"] = "failed";
  manifest.stage = "failed";
  await save(manifest);
  throw new Error(
    `Live acceptance deadline exceeded: ${lastFailure}. Run retained; no automatic retry.`,
  );
}
