import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { macFileSHA } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { executePrivateTransport } from "../host";
import { inspectOwnedMacProcesses } from "../../mac-process-inspection";
import {
  officialProbeReady,
  requireOfficialPasswordSubmission,
} from "./official-proof";
import {
  OfficialVerificationPreparedSchema,
  requireVerificationProof,
  verificationFrame,
  verificationProtocol,
  verificationWire,
} from "./official-verification-protocol";
import type { GuestRuntime } from "./runtime";

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
async function compile(runtime: GuestRuntime) {
  const directory = path.join(
    runtime.paths.evidenceDirectory,
    "official-account",
    "verification",
    crypto.randomUUID(),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sources = [];
  for (const name of [
    "OfficialOwner.swift",
    "OfficialVerification.swift",
    "official-account.swift",
  ] as const) {
    const original = path.join(runtime.exportRoot, "live-helpers", name);
    assert.equal(await macFileSHA(original), runtime.config.helpers[name]);
    const copy = path.join(
      directory,
      name === "official-account.swift" ? "main.swift" : name,
    );
    await copyFile(original, copy, 1);
    sources.push(copy);
  }
  const program = path.join(directory, "official-account");
  await runtime.command(["xcrun", "swiftc", ...sources, "-o", program]);
  await chmod(program, 0o700);
  return { program, binarySHA256: await macFileSHA(program) };
}
export async function prepareGuestOfficialVerification(
  runtime: GuestRuntime,
  operation: "probe" | "verify",
) {
  assert.equal(
    await officialProbeReady(runtime),
    true,
    "Full password privacy proof is required",
  );
  const directory = path.join(
    runtime.paths.evidenceDirectory,
    "official-account",
  );
  for (const name of [
    "verification-submission-attempt.json",
    ...(operation === "probe"
      ? ["verification-probe-ready.json", "verification-probe-attempt.json"]
      : []),
  ])
    assert.equal(
      await absent(path.join(directory, name)),
      true,
      "Inspect retained verification attempt before repeating",
    );
  const preparedPath = path.join(directory, "verification-prepared.json");
  let prepared: {
    program: string;
    binarySHA256: string;
    input: Record<string, unknown>;
  };
  if (await absent(preparedPath)) {
    assert.equal(
      operation,
      "probe",
      "Verification probe must prepare the helper first",
    );
    const executable = path.join(
      runtime.paths.officialApp,
      "Contents/MacOS/Obsidian",
    );
    const owners = await inspectOwnedMacProcesses(executable, 5000);
    assert.equal(owners.length, 1);
    const compiled = await compile(runtime);
    prepared = {
      ...compiled,
      input: {
        purpose: "live",
        mode: "verification-session",
        operation,
        sessionID: crypto.randomUUID(),
        challengeID: crypto.randomUUID(),
        runID: runtime.config.runID,
        referenceDirectory: runtime.paths.referenceDirectory,
        officialExportID: runtime.config.officialApp.exportID,
        executable,
        pid: Number(owners[0]),
        configFile: path.join(runtime.exportRoot, "live-config.json"),
        configSHA256: runtime.expectedConfigSHA,
        binarySHA256: compiled.binarySHA256,
      },
    };
  } else
    prepared = OfficialVerificationPreparedSchema.parse(
      await readOwnedMacVMJSON(preparedPath, 16_384),
    );
  assert.equal(prepared.input["runID"], runtime.config.runID);
  assert.equal(prepared.input["configSHA256"], runtime.expectedConfigSHA);
  assert.ok(
    prepared.program.startsWith(path.join(directory, "verification") + "/"),
  );
  const metadata = await lstat(prepared.program);
  assert.ok(
    metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.(),
  );
  assert.equal(await realpath(prepared.program), prepared.program);
  assert.equal(await macFileSHA(prepared.program), prepared.binarySHA256);
  prepared.input["operation"] = operation;
  prepared.input["sessionID"] = crypto.randomUUID();
  if (operation === "verify")
    requireVerificationProof(
      await readOwnedMacVMJSON(
        path.join(directory, "verification-probe-ready.json"),
        16_384,
      ),
      OfficialVerificationPreparedSchema.parse(prepared),
    );
  const fields = verificationProtocol.frames["prepare"];
  assert.ok(fields !== undefined);
  const request: Record<string, unknown> = Object.fromEntries(
    fields.map((name) => [
      name,
      name === "mode" ? "verification-prepare" : prepared.input[name],
    ]),
  );
  const reply = await executePrivateTransport(
    [prepared.program],
    verificationWire("prepare", request),
    60_000,
  );
  assert.equal(reply.exitCode, 0, "Official verification preparation failed");
  assert.equal(reply.stderr.length, 0);
  const ready = verificationFrame(
    "ready",
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reply.stdout)),
  );
  for (const name of ["runID", "sessionID", "challengeID", "pid"])
    assert.equal(ready[name], prepared.input[name]);
  const lifetime = z
    .strictObject({
      pid: z.number().int().positive(),
      startSeconds: z.number().int().nonnegative(),
      startMicroseconds: z.number().int().min(0).max(999_999),
      launchDate: z.number().positive(),
    })
    .parse(
      Object.fromEntries(
        ["pid", "startSeconds", "startMicroseconds", "launchDate"].map(
          (key) => [key, ready[key]],
        ),
      ),
    );
  await requireOfficialPasswordSubmission(runtime, lifetime);
  Object.assign(prepared.input, lifetime);
  const result = OfficialVerificationPreparedSchema.parse(prepared);
  if (await absent(preparedPath))
    await writeFile(preparedPath, JSON.stringify(result), {
      flag: "wx",
      mode: 0o600,
    });
  assert.ok(
    verificationProtocol.limits.minimumRemainingMs >
      verificationProtocol.limits.deliveryMs,
  );
  return { kind: "official-verification-prepare" as const, prepared: result };
}
