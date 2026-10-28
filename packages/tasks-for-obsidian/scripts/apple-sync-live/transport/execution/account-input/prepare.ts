import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export";
import { macFileSHA } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact";
import { inspectOwnedMacProcesses } from "../../../mac-process-inspection";
import { executePrivateTransport } from "../../host";
import { ClosedAccountReceiptSchema } from "../contract";
import type { GuestRuntime } from "../runtime";
import {
  MacInputApprovalSchema,
  MacInputInitSchema,
  MacInputPreparedSchema,
  macInputProtocol,
  type MacInputOperation,
} from "./protocol";
import { captureMacFileDescriptors } from "./collect";
import { waitMacCredentialsStatus } from "./readiness";

class MacPreparationRejected extends Error {
  constructor(readonly reason: string) {
    super("Mac private preparation rejected");
  }
}

const sourceNames = [
  "account-main.swift",
  "AccountRuntime.swift",
  "AccountOwner.swift",
  "AccountLifecycle.swift",
  "MacAccountProtocol.swift",
  "MacAccountIO.swift",
  "MacAccountSession.swift",
] as const;
const resources = [
  "mac-account.protocol.json",
  "account-input.schema.json",
] as const;
const NativeSchema = z.strictObject({
  program: z.string().startsWith("/"),
  helperSHA256: z.string().regex(/^[a-f0-9]{64}$/u),
  protocolSHA256: z.string().regex(/^[a-f0-9]{64}$/u),
  timingSHA256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type MacLifecycle = z.infer<typeof MacInputInitSchema>["lifecycle"];
export const accountInputRoot = (runtime: GuestRuntime) =>
  path.join(runtime.paths.evidenceDirectory, "account-input");
export async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  assert.ok(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid?.(),
  );
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(await realpath(directory), directory);
}
async function absent(file: string) {
  try {
    await lstat(file);
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return true;
    throw error;
  }
}
export async function prepareMacInputNative(
  runtime: GuestRuntime,
  probe: boolean,
) {
  const directory = path.join(accountInputRoot(runtime), "native"),
    record = path.join(directory, "prepared.json");
  await privateDirectory(directory);
  if (await absent(record)) {
    assert.ok(probe, "Mac privacy probe must prepare the private helper first");
    const sources = [];
    for (const name of [...sourceNames, ...resources]) {
      const source = path.join(runtime.exportRoot, "live-helpers", name);
      assert.equal(await macFileSHA(source), runtime.config.helpers[name]);
      const destination = path.join(
        directory,
        name === "account-main.swift" ? "main.swift" : name,
      );
      await copyFile(source, destination, 1);
      await chmod(destination, 0o600);
      assert.equal(await macFileSHA(destination), runtime.config.helpers[name]);
      if (name.endsWith(".swift")) sources.push(destination);
    }
    const program = path.join(directory, "mac-account-private");
    await runtime.command([
      "/usr/bin/xcrun",
      "swiftc",
      ...sources,
      "-o",
      program,
    ]);
    await chmod(program, 0o700);
    const prepared = NativeSchema.parse({
      program,
      helperSHA256: await macFileSHA(program),
      protocolSHA256: await macFileSHA(path.join(directory, resources[0])),
      timingSHA256: await macFileSHA(path.join(directory, resources[1])),
    });
    await writeFile(record, JSON.stringify(prepared), {
      flag: "wx",
      mode: 0o600,
    });
  }
  const prepared = NativeSchema.parse(await readOwnedMacVMJSON(record, 8192));
  assert.equal(prepared.program, path.join(directory, "mac-account-private"));
  for (const [file, expected, mode] of [
    [prepared.program, prepared.helperSHA256, 0o700],
    [path.join(directory, resources[0]), prepared.protocolSHA256, 0o600],
    [path.join(directory, resources[1]), prepared.timingSHA256, 0o600],
  ] as const) {
    const stat = await lstat(file);
    assert.ok(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid?.(),
    );
    assert.equal(stat.mode & 0o777, mode);
    assert.equal(await realpath(file), file);
    assert.equal(await macFileSHA(file), expected);
  }
  assert.equal(prepared.protocolSHA256, runtime.config.helpers[resources[0]]);
  assert.equal(prepared.timingSHA256, runtime.config.helpers[resources[1]]);
  return prepared;
}

export function legacyMacBinding(
  runtime: GuestRuntime,
  remoteID: string,
  lifecycle: MacLifecycle,
) {
  return {
    runID: runtime.config.runID,
    remoteID,
    runDirectory: runtime.paths.evidenceDirectory,
    executable: path.join(runtime.paths.app, "Contents/MacOS/FacetAcceptance"),
    container: runtime.paths.container,
    stateDirectory: runtime.paths.stateDirectory,
    lifecycle,
    guestConfigSHA256: runtime.expectedConfigSHA,
  };
}
export async function inspectMacInput(
  program: string,
  binding: ReturnType<typeof legacyMacBinding>,
  mode: string,
  lifetime?: {
    startSeconds: number;
    startMicroseconds: number;
    launchDate: number;
  },
) {
  const owners = await inspectOwnedMacProcesses(binding.executable, 5000);
  assert.equal(owners.length, 1);
  const pid = Number(owners[0]);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const bytes = new TextEncoder().encode(
    JSON.stringify({ ...binding, pid, mode, ...lifetime }) + "\n",
  );
  const result = await executePrivateTransport([program], bytes, 30_000);
  assert.equal(result.stderr.length, 0);
  const receipt = ClosedAccountReceiptSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout)),
  );
  if (receipt.blocked !== undefined)
    throw new MacPreparationRejected(receipt.blocked);
  assert.equal(
    result.exitCode,
    0,
    "Mac private preparation rejected normal controls",
  );
  assert.equal(receipt.blocked, undefined);
  assert.equal(receipt.runID, binding.runID);
  return receipt;
}

async function waitFixtureStatus(runtime: GuestRuntime, startedAt: number) {
  await waitMacCredentialsStatus(
    {
      runID: runtime.config.runID,
      readStatus: () =>
        readOwnedMacVMJSON(
          path.join(runtime.paths.stateDirectory, "control/status.json"),
          65_536,
        ),
    },
    startedAt,
  );
}

export async function waitInspection(
  program: string,
  binding: ReturnType<typeof legacyMacBinding>,
  mode: string,
) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      return await inspectMacInput(program, binding, mode);
    } catch (error) {
      if (
        !(error instanceof MacPreparationRejected) ||
        !["window", "field", "setter"].includes(error.reason) ||
        Date.now() >= deadline
      )
        throw error;
    }
    await Bun.sleep(100);
  }
}

export async function prepareGuestMacInput(
  runtime: GuestRuntime,
  operation: MacInputOperation,
  sessionID: string,
  context: { remoteID: string; lifecycle: MacLifecycle },
) {
  const { remoteID, lifecycle } = context;
  const selected = macInputProtocol.operations[operation];
  const native = await prepareMacInputNative(runtime, selected.probe);
  const root = accountInputRoot(runtime),
    evidenceDirectory = path.join(root, "sessions", sessionID);
  await privateDirectory(path.join(root, "sessions"));
  await mkdir(evidenceDirectory, { recursive: false, mode: 0o700 });
  const binding = legacyMacBinding(runtime, remoteID, lifecycle);
  if (selected.probe) {
    assert.equal(
      lifecycle,
      null,
      "Synthetic privacy probe cannot inherit lifecycle credentials",
    );
    await writeFile(
      path.join(root, "probe-attempt-" + selected.phase + ".json"),
      JSON.stringify({ operation, sessionID, runID: runtime.config.runID }),
      { flag: "wx", mode: 0o600 },
    );
    await runtime.retire();
    for (const name of ["app.stdout", "app.stderr"])
      await writeFile(path.join(evidenceDirectory, name), new Uint8Array(), {
        flag: "wx",
        mode: 0o600,
      });
    const launchedAt = Date.now();
    await runtime.command([
      "/usr/bin/open",
      "-n",
      "--stdout",
      path.join(evidenceDirectory, "app.stdout"),
      "--stderr",
      path.join(evidenceDirectory, "app.stderr"),
      "--env",
      "FACET_E2E_ACCOUNT_OPERATION=fixture-verification",
      "--env",
      "FACET_E2E_ACCOUNT_MODE=fixture-verification",
      "--env",
      "FACET_E2E_RUN_ID=" + runtime.config.runID,
      "--env",
      "FACET_E2E_ACCOUNT_SESSION=" + sessionID,
      runtime.paths.app,
      "--args",
      "--facet-acceptance-descriptor",
      runtime.paths.descriptor,
    ]);
    await waitFixtureStatus(runtime, launchedAt);
    const fixture = z.strictObject({
      schemaVersion: z.literal(1),
      mode: z.literal("fixture-verification"),
      runID: z.literal(runtime.config.runID),
      sessionID: z.literal(sessionID),
    });
    fixture.parse(
      await readOwnedMacVMJSON(
        path.join(
          runtime.paths.stateDirectory,
          "accounts",
          "verification-fixture-" + sessionID,
          "identity.json",
        ),
        4096,
      ),
    );
    const initial = await waitInspection(
      native.program,
      binding,
      "inspect_onboarding",
    );
    const lifetime = z
      .object({
        startSeconds: z.number(),
        startMicroseconds: z.number(),
        launchDate: z.number(),
      })
      .parse(initial);
    await inspectMacInput(native.program, binding, "present_account", lifetime);
  }
  const inspectionMode =
    "inspect_" +
    (selected.initialStage === "vaults" ? "vault" : selected.initialStage);
  const inspected = selected.probe
    ? await waitInspection(native.program, binding, inspectionMode)
    : await inspectMacInput(native.program, binding, inspectionMode);
  assert.equal(inspected.ready, true);
  const approvalPath = path.join(
    runtime.paths.stateDirectory,
    "account-input/private-input-approved.json",
  );
  let approvalSHA256: string | null = null;
  if (!selected.probe) {
    const bytes = await readFile(approvalPath),
      approval = MacInputApprovalSchema.parse(JSON.parse(bytes.toString()));
    assert.equal(approval.runID, runtime.config.runID);
    assert.equal(approval.guestConfigSHA256, runtime.expectedConfigSHA);
    for (const key of [
      "helperSHA256",
      "protocolSHA256",
      "timingSHA256",
    ] as const)
      assert.equal(approval[key], native[key]);
    approvalSHA256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  }
  const input = MacInputInitSchema.parse({
    schemaVersion: 1,
    kind: "mac-private-account-input",
    mode: "private_session",
    operation,
    sessionID,
    ...binding,
    pid: inspected.pid,
    startSeconds: inspected.startSeconds,
    startMicroseconds: inspected.startMicroseconds,
    launchDate: inspected.launchDate,
    requestID: inspected.requestID ?? null,
    helperSHA256: native.helperSHA256,
    protocolSHA256: native.protocolSHA256,
    timingSHA256: native.timingSHA256,
    approvalSHA256,
  });
  const prepared = MacInputPreparedSchema.parse({
    kind: "mac-input-prepared",
    program: native.program,
    input,
    evidenceDirectory,
    probe: selected.probe,
  });
  await writeFile(
    path.join(evidenceDirectory, "prepared.json"),
    JSON.stringify(prepared),
    { flag: "wx", mode: 0o600 },
  );
  if (selected.probe) await captureMacFileDescriptors(prepared, "before");
  return prepared;
}
