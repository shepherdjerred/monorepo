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
import { executePrivateTransport, type TransportCommand } from "../host";
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

const preparationLimits = { stdout: 8192, stderr: 4096 };
const preparationDiagnostic = z.strictObject({
  blocked: z.enum([
    "input",
    "binding",
    "process",
    "session",
    "form",
    "focus",
    "delivery",
    "internal",
  ]),
  phase: z.enum(verificationProtocol.preparationPhases),
  submitActionCount: z.literal(0),
});

async function retainPreparationFiles(
  directory: string,
  files: [string, Uint8Array | string][],
) {
  let failed = false;
  for (const [name, bytes] of files) {
    try {
      await writeFile(path.join(directory, name), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      failed = true;
    }
  }
  if (failed)
    throw new Error(
      "Official verification preparation evidence retention failed",
    );
}

/** This boundary accepts only the no-code prepare frame; real session streams never enter it. */
export async function runVerificationPreparation(
  program: string,
  request: Record<string, unknown>,
  execute: TransportCommand = executePrivateTransport,
) {
  const frame = verificationWire("prepare", request);
  const directory = path.join(
    path.dirname(program),
    "preparation-" + z.uuid().parse(request["sessionID"]),
  );
  await mkdir(directory, { mode: 0o700 });
  const binding = Object.fromEntries(
    [
      "runID",
      "sessionID",
      "challengeID",
      "pid",
      "configSHA256",
      "binarySHA256",
    ].map((name) => [name, request[name]]),
  );
  let reply: Awaited<ReturnType<TransportCommand>>;
  try {
    reply = await execute([program], frame, 60_000);
  } catch {
    await retainPreparationFiles(directory, [
      [
        "diagnostic.json",
        JSON.stringify({
          schemaVersion: 1,
          classification: "transport-failed",
          rawResponseAvailable: false,
          binding,
        }),
      ],
    ]);
    throw new Error(
      "Official verification preparation transport failed; inspect retained closed diagnostic",
    );
  }
  const receipt = {
    schemaVersion: 1,
    phase: "official-verification-no-code-preparation",
    exitCode: reply.exitCode,
    stdoutBytes: reply.stdout.length,
    stderrBytes: reply.stderr.length,
    stdoutTruncated: reply.stdout.length > preparationLimits.stdout,
    stderrTruncated: reply.stderr.length > preparationLimits.stderr,
    binding,
  };
  // Retain bounded no-code bytes and exit metadata before parsing or enforcing any native guard.
  await retainPreparationFiles(directory, [
    ["stdout", reply.stdout.subarray(0, preparationLimits.stdout)],
    ["stderr", reply.stderr.subarray(0, preparationLimits.stderr)],
    ["exit.json", JSON.stringify(receipt)],
  ]);
  const bounded = !receipt.stdoutTruncated && !receipt.stderrTruncated;
  let decoded: unknown;
  if (bounded) {
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(reply.stdout),
      );
    } catch {
      decoded = null;
    }
  }
  const diagnostic = preparationDiagnostic.safeParse(decoded);
  await writeFile(
    path.join(directory, "diagnostic.json"),
    JSON.stringify({
      schemaVersion: 1,
      classification: diagnostic.success
        ? "native-guard"
        : bounded
          ? "unclassified"
          : "output-bound",
      native: diagnostic.success ? diagnostic.data : null,
    }),
    { flag: "wx", mode: 0o600 },
  );
  assert.ok(bounded, "Official verification preparation output exceeded bound");
  assert.equal(
    reply.exitCode,
    0,
    "Official verification preparation failed; inspect retained closed diagnostic",
  );
  assert.equal(
    reply.stderr.length,
    0,
    "Official verification preparation emitted diagnostics",
  );
  return verificationFrame("ready", decoded);
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
    "OfficialAccountContainer.swift",
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
  const ready = await runVerificationPreparation(prepared.program, request);
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
