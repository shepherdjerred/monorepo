import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { stopOwnedMacProcess } from "./mac-process-owner";
import {
  packageRoot,
  iosBundle,
  macBundle,
  uuid,
  type Client,
  requiredCases,
  ManifestSchema,
  type Manifest,
  validate,
  assertOwnedSimulator,
  runDirectory,
  atomicJSON,
  activeClients,
  clientState,
  hasIOS,
} from "./model";
import { guestStatus, requestGuest } from "./transport/client";
import {
  ArchiveLineageSchema,
  assertArchiveBinding,
} from "./reference-archive/contract";

export async function command(
  argv: string[],
  cwd = packageRoot,
  extraEnvironment: Record<string, string> = {},
  options:
    | string
    | { logFile?: string; stderrLogFile?: string; timeoutMS?: number } = {},
) {
  const {
    logFile,
    stderrLogFile,
    timeoutMS = 120_000,
  } = typeof options === "string" ? { logFile: options } : options;
  z.number().int().positive().max(900_000).parse(timeoutMS);
  // Only native developer-tool bootstrap values reach child processes.
  const environment: Record<string, string> = {
    MISE_EXEC_AUTO_INSTALL: "false",
    ...extraEnvironment,
  };
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "DEVELOPER_DIR",
    "SDKROOT",
    "LANG",
    "USER",
    "LOGNAME",
  ])
    if (Bun.env[key] !== undefined) environment[key] = Bun.env[key];
  const child = Bun.spawn(argv, {
    cwd,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
    ...(logFile === undefined ? { maxBuffer: 2 * 1024 * 1024 } : {}),
  });
  const timeout = { expired: false };
  const timer = setTimeout(() => {
    timeout.expired = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, timeoutMS);
  let output: string;
  let exitCode: number;
  try {
    [output, exitCode] = await Promise.all([
      captureCommandOutput(child.stdout, logFile),
      child.exited,
      Bun.write(
        stderrLogFile === undefined ? Bun.stderr : Bun.file(stderrLogFile),
        new Response(child.stderr),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (timeout.expired)
    throw new Error("Acceptance child command exceeded its deadline");
  if (exitCode !== 0)
    throw new Error(`${argv.slice(0, 2).join(" ")} exited ${String(exitCode)}`);
  if (output.length > 2 * 1024 * 1024)
    throw new Error("Structured command output exceeds its limit");
  return output.trim();
}

async function captureCommandOutput(
  stream: ReadableStream<Uint8Array>,
  logFile?: string,
): Promise<string> {
  if (logFile === undefined) return new Response(stream).text();
  await Bun.write(logFile, new Response(stream));
  return "";
}

async function rebaseOwnedIOS(manifest: Manifest, ios: string) {
  if (!hasIOS(manifest)) throw new Error("iOS is not selected");
  if (
    manifest.clients === null ||
    !("ios" in manifest.clients) ||
    ios === manifest.clients.ios.container
  )
    return;
  // Xcode may relocate an existing data container. Its copied descriptor must
  // still bind this exact run and vault before we accept the new root.
  const descriptorFile = path.join(ios, "Documents/acceptance.json");
  const bindingData: unknown = await Bun.file(descriptorFile).json();
  validate("descriptor", bindingData);
  const binding = z
    .object({
      runID: uuid,
      allowedRemoteVaultID: z.string().nullable().optional(),
    })
    .parse(bindingData);
  if (
    binding.runID !== manifest.runID ||
    (binding.allowedRemoteVaultID ?? null) !== manifest.allowedRemoteVaultID
  )
    throw new Error("Relocated app container lost its run binding");
  manifest.clients.ios = {
    container: ios,
    descriptor: descriptorFile,
    stateDirectory: path.join(
      ios,
      "Library/Application Support/FacetAcceptance",
      manifest.runID,
    ),
  };
  await save(manifest);
}

export async function readManifest(
  runID: string,
  timeoutMS = 120_000,
): Promise<Manifest> {
  const directory = runDirectory(runID);
  if ((await realpath(directory)) !== directory)
    throw new Error("Unsafe acceptance run directory");
  const manifest = ManifestSchema.parse(
    await Bun.file(path.join(directory, "manifest.json")).json(),
  );
  if (manifest.runID !== runID.toLowerCase())
    throw new Error("Manifest run identity mismatch");
  if (manifest.clients !== null && manifest.stage !== "cleaned") {
    const deadline = Date.now() + timeoutMS;
    const mac = path.join(
      os.homedir(),
      "Library/Containers",
      macBundle,
      "Data",
    );
    let ios: string | undefined;
    if (hasIOS(manifest)) {
      if (manifest.simulator === null)
        throw new Error("Missing owned simulator");
      assertOwnedSimulator(
        manifest.runID,
        manifest.simulator,
        JSON.parse(
          await command(
            ["xcrun", "simctl", "list", "devices", "--json"],
            packageRoot,
            {},
            { timeoutMS: Math.max(1, deadline - Date.now()) },
          ),
        ),
      );
      ios = await command(
        [
          "xcrun",
          "simctl",
          "get_app_container",
          manifest.simulator.id,
          iosBundle,
          "data",
        ],
        packageRoot,
        {},
        { timeoutMS: Math.max(1, deadline - Date.now()) },
      );
      await rebaseOwnedIOS(manifest, ios);
    }
    assertClientContainers(manifest, mac, ios);
  }
  return manifest;
}

function assertClientContainers(manifest: Manifest, mac: string, ios?: string) {
  for (const client of activeClients(manifest)) {
    if (client === "macos" && manifest.schemaVersion === 3) continue;
    const expected = client === "ios" ? ios : mac;
    if (expected === undefined) throw new Error("Missing selected container");
    const actual = clientState(manifest, client);
    if (
      actual.container !== expected ||
      actual.descriptor !==
        (client === "ios"
          ? path.join(expected, "Documents/acceptance.json")
          : path.join(
              expected,
              "Library/Application Support/FacetAcceptance",
              manifest.runID,
              "acceptance.json",
            )) ||
      actual.stateDirectory !==
        path.join(
          expected,
          "Library/Application Support/FacetAcceptance",
          manifest.runID,
        )
    )
      throw new Error("Manifest escapes its application container");
  }
}

export async function save(manifest: Manifest) {
  const accepted = ManifestSchema.parse(manifest);
  await atomicJSON(
    path.join(runDirectory(accepted.runID), "manifest.json"),
    accepted,
  );
  if (accepted.schemaVersion === 3) {
    const result = await requestGuest(accepted, {
      kind: "checkpoint",
      checkpoint: {
        stage: accepted.stage,
        scope: accepted.scope,
        officialReferencePassed:
          accepted.cases["official-reference"] === "pass",
        initialDownloadPassed: accepted.cases["initial-download"] === "pass",
        lifecycleBeginPassed:
          accepted.operations["lifecycle-begin:macos"] === "pass",
        lifecycleFinishPresent:
          accepted.operations["lifecycle-finish:macos"] !== undefined,
        failuresCount: accepted.failures.length,
        completedRounds: accepted.completedRounds,
      },
    });
    if (result.kind !== "checkpoint")
      throw new Error("Wrong guest checkpoint response");
  }
}

export function descriptor(
  manifest: Manifest,
  client: Client,
  vaultID: string | null,
) {
  const state = clientState(manifest, client);
  return {
    schemaVersion: 1,
    runID: manifest.runID,
    stateDirectory:
      client === "ios"
        ? `/Library/Application Support/FacetAcceptance/${manifest.runID}`
        : state.stateDirectory,
    allowedRemoteVaultID: vaultID,
  };
}

export async function writeDescriptors(
  manifest: Manifest,
  vaultID: string | null,
) {
  if (manifest.clients === null) throw new Error("Apps are not prepared");
  for (const client of activeClients(manifest)) {
    const value = descriptor(manifest, client, vaultID);
    validate("descriptor", value);
    if (client === "macos" && manifest.schemaVersion === 3) {
      await requestGuest(manifest, { kind: "descriptor", vaultID });
      continue;
    }
    await atomicJSON(clientState(manifest, client).descriptor, value);
  }
}

export async function bindVault(manifest: Manifest, vaultID: string) {
  if (
    manifest.stage !== "owner-setup" ||
    manifest.clients === null ||
    manifest.cases["official-reference"] !== "pass"
  )
    throw new Error("Run is not ready for vault binding");
  z.string().min(1).max(256).parse(vaultID);
  const provenance = z
    .object({ referenceArchive: ArchiveLineageSchema.optional() })
    .parse(
      await Bun.file(
        path.join(runDirectory(manifest.runID), "provenance.json"),
      ).json(),
    );
  assertArchiveBinding(
    manifest.referenceArchive,
    provenance.referenceArchive,
    vaultID,
  );
  await writeDescriptors(manifest, vaultID);
  manifest.allowedRemoteVaultID = vaultID;
  manifest.stage = "bound";
  await save(manifest);
  console.log(
    "Exact remote vault bound. Run resume to open the isolated apps, then sign in manually. Keep recordings off until authentication finishes.",
  );
}

export async function launch(
  manifest: Manifest,
  discovery = false,
  onlyClient?: Client,
  timeoutMS = 120_000,
) {
  z.number().int().positive().max(900_000).parse(timeoutMS);
  const launchDeadline = Date.now() + timeoutMS;
  const remainingMS = () => {
    const remaining = launchDeadline - Date.now();
    if (remaining <= 0)
      throw new Error("Acceptance launch exceeded its deadline");
    return remaining;
  };
  const runCommand = (
    argv: string[],
    environment: Record<string, string> = {},
  ) => command(argv, packageRoot, environment, { timeoutMS: remainingMS() });
  if (
    manifest.clients === null ||
    (!discovery && manifest.allowedRemoteVaultID === null)
  )
    throw new Error("Bind the remote test vault first");
  if (onlyClient !== undefined) clientState(manifest, onlyClient);
  const selected =
    onlyClient === undefined ? activeClients(manifest) : [onlyClient];
  if (selected.includes("ios")) {
    if (manifest.simulator === null) throw new Error("Missing owned simulator");
    assertOwnedSimulator(
      manifest.runID,
      manifest.simulator,
      JSON.parse(
        await runCommand(["xcrun", "simctl", "list", "devices", "--json"]),
      ),
    );
    await runCommand(
      [
        "xcrun",
        "simctl",
        "launch",
        "--terminate-running-process",
        manifest.simulator.id,
        iosBundle,
        "--facet-acceptance-descriptor",
        "@documents/acceptance.json",
      ],
      { SIMCTL_CHILD_FACET_E2E_SIMULATOR: manifest.simulator.id },
    );
  }
  const app = path.join(
    runDirectory(manifest.runID),
    "macos/Build/Products/Debug/FacetAcceptance.app",
  );
  if (selected.includes("macos")) {
    if (manifest.schemaVersion === 3) {
      await requestGuest(manifest, {
        kind: "launch",
        discovery,
        timeoutMS: remainingMS(),
      });
      return;
    }
    requireHostUI(manifest);
    const executable = path.join(app, "Contents/MacOS/FacetAcceptance");
    await stopOwnedMacProcess(executable, remainingMS);
    await runCommand([
      "open",
      "-n",
      app,
      "--args",
      "--facet-acceptance-descriptor",
      clientState(manifest, "macos").descriptor,
    ]);
  }
}

export async function statuses(manifest: Manifest) {
  if (manifest.clients === null) throw new Error("Apps are not prepared");
  return Promise.all(
    activeClients(manifest).map(async (client) => ({
      client,
      value:
        client === "macos" && manifest.schemaVersion === 3
          ? await guestStatus(manifest)
          : z
              .unknown()
              .parse(
                await Bun.file(
                  path.join(
                    clientState(manifest, client).stateDirectory,
                    "control/status.json",
                  ),
                ).json(),
              ),
    })),
  );
}

export async function resume(manifest: Manifest) {
  await launch(manifest);
  console.log(
    `Owner checkpoint: enter credentials/MFA and choose only the bound test vault in ${activeClients(manifest).join(" and ")}. Authentication is not recorded. Run verify after every selected client is connected.`,
  );
}

export async function cleanup(manifest: Manifest) {
  if (requiredCases.some((entry) => manifest.cases[entry] !== "pass"))
    throw new Error(
      "Acceptance is incomplete; retain the failed/pending run for diagnosis",
    );
  if (!hasIOS(manifest)) {
    manifest.stage = "cleaned";
    await save(manifest);
    console.log(
      "Mac-only acceptance completed. App data, remote vault and private evidence retained; no simulator exists to delete.",
    );
    return;
  }
  if (manifest.simulator === null) throw new Error("Missing owned simulator");
  const available: unknown = JSON.parse(
    await command(["xcrun", "simctl", "list", "devices", "--json"]),
  );
  assertOwnedSimulator(manifest.runID, manifest.simulator, available);
  const devices = z
    .object({
      devices: z.record(
        z.string(),
        z.array(z.object({ udid: uuid, state: z.string() })),
      ),
    })
    .parse(available);
  const device = Object.values(devices.devices)
    .flat()
    .find((entry) => entry.udid === manifest.simulator?.id);
  if (device?.state === "Booted")
    await command(["xcrun", "simctl", "shutdown", manifest.simulator.id]);
  else if (device?.state !== "Shutdown")
    throw new Error("Owned simulator is not in a safe cleanup state");
  await command(["xcrun", "simctl", "delete", manifest.simulator.id]);
  manifest.stage = "cleaned";
  await save(manifest);
  console.log(
    "Deleted only the manifest-owned disposable simulator. Remote vault and private evidence retained.",
  );
}

export function requireHostUI(manifest: Manifest) {
  if (manifest.schemaVersion !== 3 && !Bun.argv.includes("--host-ui"))
    throw new Error(
      "Host Mac UI requires explicit --host-ui; automated live acceptance requires --vm",
    );
}
