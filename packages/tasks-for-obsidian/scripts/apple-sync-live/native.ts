import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  packageRoot,
  macBundle,
  type Client,
  type Manifest,
  StatusSchema,
  validate,
  settledProfile,
  assertOwnedSimulator,
  runDirectory,
  atomicJSON,
  activeClients,
  clientState,
} from "./model";
import {
  command,
  readManifest,
  save,
  descriptor,
  statuses,
  launch,
  requireHostUI,
} from "./platform";
import {
  assertExactNativeJourney,
  assertDistinctNativeEvidenceLabels,
  selectedInitialConfigurationJourneys,
  assertSelectedNativeClients,
} from "./native-evidence";
import {
  readVaultFile,
  verifyVaultEndpoint,
  localVault,
} from "./replicas/access";
import { guestControl } from "./transport/client";
import { localControl } from "./replicas/control";
import {
  runGuestNativeTest,
  selectedClientConfiguration,
  type NativeTestOptions,
} from "./replicas/native";

export function nativeClientConfiguration(manifest: Manifest, client: Client) {
  return selectedClientConfiguration(manifest, client);
}

export async function runNativeTest(
  manifest: Manifest,
  client: Client,
  selector: string,
  options: NativeTestOptions,
) {
  if (client === "macos" && manifest.schemaVersion === 3)
    return runGuestNativeTest(manifest, selector, options);
  if (client === "macos") requireHostUI(manifest);
  return runLocalNativeTest(manifest, client, selector, options);
}

async function runLocalNativeTest(
  manifest: Manifest,
  client: Client,
  selector: string,
  options: NativeTestOptions,
) {
  const selected = nativeClientConfiguration(manifest, client);
  const { label, extra = {}, timeoutMS = 600_000 } = options;
  z.number().int().positive().max(600_000).parse(timeoutMS);
  const deadline = Date.now() + timeoutMS;
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
  if (client === "ios" && manifest.simulator !== null)
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
  const { target } = selected;
  const existing = z
    .object({ EnvironmentVariables: z.record(z.string(), z.string()) })
    .parse(configuration[target]);
  const existingEnvironment = { ...existing.EnvironmentVariables };
  if (client === "macos") delete existingEnvironment["FACET_E2E_SIMULATOR"];
  const environment = {
    ...existingEnvironment,
    FACET_E2E_RUN_ID: manifest.runID,
    FACET_E2E_DESCRIPTOR:
      client === "ios"
        ? "@documents/acceptance.json"
        : selected.state.descriptor,
    FACET_E2E_DESCRIPTOR_JSON: JSON.stringify(
      descriptor(manifest, client, manifest.allowedRemoteVaultID),
    ),
    ...selected.simulatorEnvironment,
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
    client === "macos" ? "keepNever" : "keepAlways",
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
        selected.destination,
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
      assertSelectedNativeClients(manifest, current);
      for (const { client, value } of current) {
        const profile = settledProfile(
          value,
          manifest.runID,
          manifest.allowedRemoteVaultID,
          Date.now(),
        );
        await verifyVaultEndpoint(
          manifest,
          { client, profileID: profile.profileID },
          expected,
        );
      }
      await verifyVaultEndpoint(manifest, "official", expected);
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
  clientState(manifest, client);
  Object.assign(manifest, await readManifest(manifest.runID, timeoutMS));
  const current = await statuses(manifest);
  assertSelectedNativeClients(manifest, current);
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
  clientState(manifest, client);
  return localVault(manifest, { client, profileID });
}

export async function control(
  manifest: Manifest,
  client: Client,
  kind: "refresh" | "interrupt" | "resume",
  profileID?: string,
) {
  clientState(manifest, client);
  if (manifest.clients === null || manifest.allowedRemoteVaultID === null)
    throw new Error("Run is not bound");
  if (client === "macos" && manifest.schemaVersion === 3) {
    await guestControl(manifest, kind, profileID);
    return;
  }
  return localControl(manifest, client, kind, profileID);
}

export async function verify(manifest: Manifest) {
  if (manifest.clients === null || manifest.allowedRemoteVaultID === null)
    throw new Error("Bind the test vault before verification");
  if (manifest.cases["official-reference"] !== "pass")
    throw new Error(
      "Run seal-reference after installing and enabling official TaskNotes 4.13.8",
    );
  const directory = runDirectory(manifest.runID);
  const deadline =
    Date.now() +
    (manifest.round === 1 && manifest.cases["initial-download"] !== "pass"
      ? 180_000
      : 120_000);
  const remainingMS = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error("Initial acceptance exceeded its deadline");
    return remaining;
  };
  try {
    await launch(manifest, false, undefined, remainingMS());
    await waitForConvergence(manifest, manifest.reference, remainingMS());
    const bytes = await readVaultFile(
      manifest,
      "official",
      "Tasks/Existing.md",
    );
    const note = bytes.toString("utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
      note,
    )?.[1];
    if (frontmatter === undefined)
      throw new Error("Initial reference task has no frontmatter");
    const expectedTask = z
      .object({ title: z.string().trim().min(1) })
      .parse(Bun.YAML.parse(frontmatter));
    const selector =
      "LiveSyncVaultUITests/testInitialDownloadUsesTaskNotesConfiguration";
    // Byte convergence alone does not prove that the app can load its provider.
    // Each selected native test must execute once and prove visible usable tasks.
    const journeys = selectedInitialConfigurationJourneys(manifest);
    assertDistinctNativeEvidenceLabels(journeys);
    for (const { client, label } of journeys) {
      await runNativeTest(manifest, client, selector, {
        label,
        timeoutMS: remainingMS(),
        extra: {
          FACET_E2E_ROUND: String(manifest.round),
          FACET_E2E_INITIAL_TASK_TITLE: expectedTask.title,
        },
      });
      await launch(manifest, false, client, remainingMS());
    }
    const current = await waitForConvergence(
      manifest,
      manifest.reference,
      remainingMS(),
    );
    remainingMS();
    // Retain only schema-checked projections and explicit selected-test proof.
    await atomicJSON(path.join(directory, "initial-download.json"), {
      schemaVersion: 1,
      runID: manifest.runID,
      round: manifest.round,
      capturedAt: new Date().toISOString(),
      clients: current,
      usability: { selector, clients: activeClients(manifest) },
    });
    manifest.cases["initial-download"] = "pass";
    manifest.stage = "initial-verified";
    await save(manifest);
    console.log(
      `Initial acceptance passed: selected clients (${activeClients(manifest).join(", ")}) load the TaskNotes configuration and show the expected task; their replicas and the official reference match exact file hashes. Other cases remain pending.`,
    );
  } catch (error) {
    manifest.cases["initial-download"] = "failed";
    manifest.stage = "failed";
    await save(manifest);
    throw error;
  }
}
