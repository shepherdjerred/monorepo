import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scanPrivateInputEvidence } from "../../../../ios-account/leak-check";
import { acceptanceProvenance } from "../../../ledger";
import { digest, runDirectory, type Manifest } from "../../../model";
import {
  FileFingerprintSchema,
  RelativePathSchema,
  SHA256Schema,
} from "../../fields";
import {
  MacInputApprovalSchema,
  MacInputPreparedSchema,
  type MacInputPrepared,
} from "./protocol";
import type { MacInputCapture } from "./session";
import {
  NativeWindowSchema,
  validateMacMeasuredOutputs,
  type MacNativeWindow,
} from "./measurement";

type GuestManifest = Extract<Manifest, { schemaVersion: 3 }>;
const BindingSchema = z.strictObject({
  runID: z.uuid(),
  sourceHead: z.string().regex(/^[a-f0-9]{40}$/u),
  provenanceSHA256: SHA256Schema,
  guestConfigSHA256: SHA256Schema,
  artifactSHA256: SHA256Schema,
  payloadSHA256: SHA256Schema,
  protocolSHA256: SHA256Schema,
  timingSHA256: SHA256Schema,
});
const PhaseProofSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("mac-private-input-phase-proof"),
  phase: z.enum(["credentials", "verification"]),
  binding: BindingSchema,
  prepared: MacInputPreparedSchema,
  directory: z.string().startsWith("/"),
  raw: z.record(RelativePathSchema, FileFingerprintSchema),
  scanPassed: z.literal(true),
  nativePassed: z.literal(true),
  guestCollectionPassed: z.literal(true),
  transportComplete: z.literal(true),
  semanticPassed: z.literal(true),
  nativeWindow: NativeWindowSchema,
  scope: z.literal(
    "owned-fixture-native-transport-declared-FDs-and-PID-time-unified-logs",
  ),
  mediaCount: z.literal(0),
});
export const macInputProofRoot = (manifest: GuestManifest) =>
  path.join(runDirectory(manifest.runID), "mac-account-input");
export async function retainMacRawStreams(
  directory: string,
  capture: Pick<MacInputCapture, "stdout" | "stderr">,
) {
  let failed = false;
  for (const [name, bytes] of [
    ["native.stdout", capture.stdout],
    ["native.stderr", capture.stderr],
  ] as const) {
    try {
      await writeFile(path.join(directory, name), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      failed = true;
    }
  }
  return !failed;
}
async function ownedDirectory(directory: string, create = false) {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  assert.ok(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid?.(),
  );
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(await realpath(directory), directory);
}
async function binding(manifest: GuestManifest) {
  const bytes = await readFile(
    path.join(runDirectory(manifest.runID), "provenance.json"),
  );
  const provenance = acceptanceProvenance(
    manifest,
    JSON.parse(bytes.toString()),
  );
  return BindingSchema.parse({
    runID: manifest.runID,
    sourceHead: provenance.sourceHead,
    provenanceSHA256: digest(bytes),
    guestConfigSHA256: manifest.execution.guestConfigSHA256,
    artifactSHA256: manifest.execution.artifactSHA256,
    payloadSHA256: manifest.execution.payloadSHA256,
    protocolSHA256:
      provenance.sourceFiles[
        "packages/tasknotes-macos/scripts/native/mac-account/mac-account.protocol.json"
      ],
    timingSHA256:
      provenance.sourceFiles[
        "packages/tasks-for-obsidian/scripts/ios-account/account-input.schema.json"
      ],
  });
}
async function ownedBytes(file: string, maximum = 4 * 1024 * 1024) {
  const stat = await lstat(file);
  assert.ok(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid?.() &&
      stat.size <= maximum,
  );
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(await realpath(file), file);
  return readFile(file);
}
export async function retainMacInputPhase(options: {
  manifest: GuestManifest;
  prepared: MacInputPrepared;
  capture: MacInputCapture;
  guestFiles: Record<string, Uint8Array>;
  guestCollectionPassed: boolean;
  nativePassed: boolean;
  sentinels: string[];
  verificationCode?: string;
  nativeWindow: MacNativeWindow;
}) {
  const { manifest, prepared } = options;
  const phase =
    prepared.input.operation === "credentials-probe"
      ? "credentials"
      : "verification";
  const root = macInputProofRoot(manifest),
    directory = path.join(root, "probes", prepared.input.sessionID);
  for (const item of [
    root,
    path.join(root, "probes"),
    directory,
    path.join(directory, "guest"),
  ])
    await ownedDirectory(item, true);
  let retentionFailed = !(await retainMacRawStreams(
    directory,
    options.capture,
  ));
  const prefix = "account-input/sessions/" + prepared.input.sessionID + "/";
  for (const [relative, bytes] of Object.entries(options.guestFiles)) {
    RelativePathSchema.parse(relative);
    assert.ok(relative.startsWith(prefix));
    const name = relative.slice(prefix.length);
    assert.ok(name.length > 0 && !name.includes("/"));
    try {
      await writeFile(path.join(directory, "guest", name), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      retentionFailed = true;
    }
  }
  const current = await binding(manifest);
  if (retentionFailed) {
    await writeFile(
      path.join(directory, "retention-failed.json"),
      JSON.stringify({
        schemaVersion: 1,
        phase,
        classification: "synthetic-raw-retention-incomplete",
      }),
      { flag: "wx", mode: 0o600 },
    );
    throw new Error("Mac synthetic raw retention incomplete");
  }
  let semanticPassed = false;
  const guestByName = Object.fromEntries(
    Object.entries(options.guestFiles).map(([name, bytes]) => [
      path.basename(name),
      bytes,
    ]),
  );
  try {
    validateMacMeasuredOutputs({
      prepared,
      nativeStdout: options.capture.stdout,
      nativeStderr: options.capture.stderr,
      guestFiles: guestByName,
      nativeWindow: options.nativeWindow,
    });
    semanticPassed = true;
  } catch {
    /* All captured bytes remain available; an invalid receipt cannot approve input. */
  }
  const metadata = {
    schemaVersion: 1,
    phase,
    binding: current,
    prepared,
    nativeWindow: options.nativeWindow,
    semanticPassed,
    nativePassed: options.nativePassed,
    guestCollectionPassed: options.guestCollectionPassed,
    transportComplete: options.capture.complete,
  };
  await writeFile(
    path.join(directory, "result.json"),
    JSON.stringify(metadata),
    { flag: "wx", mode: 0o600 },
  );
  let scanned: Awaited<ReturnType<typeof scanPrivateInputEvidence>> | undefined;
  try {
    scanned = await scanPrivateInputEvidence(
      directory,
      options.sentinels,
      options.verificationCode === undefined
        ? undefined
        : { phase: "verification", code: options.verificationCode },
    );
  } catch {
    /* Raw synthetic evidence stays intact; no value-bearing error escapes. */
  }
  const passed =
    scanned !== undefined &&
    semanticPassed &&
    options.nativePassed &&
    options.guestCollectionPassed &&
    options.capture.complete;
  await writeFile(
    path.join(directory, "measurement.json"),
    JSON.stringify({ ...metadata, scanPassed: scanned !== undefined, passed }),
    { flag: "wx", mode: 0o600 },
  );
  assert.ok(
    passed && scanned !== undefined,
    "Mac synthetic privacy or output measurement failed",
  );
  // Include the measurement receipt too; its public bytes contain no sentinel values.
  scanned = await scanPrivateInputEvidence(
    directory,
    options.sentinels,
    options.verificationCode === undefined
      ? undefined
      : { phase: "verification", code: options.verificationCode },
  );
  const proof = PhaseProofSchema.parse({
    schemaVersion: 1,
    kind: "mac-private-input-phase-proof",
    phase,
    binding: current,
    prepared,
    directory,
    raw: scanned.files,
    scanPassed: true,
    nativePassed: true,
    guestCollectionPassed: true,
    transportComplete: true,
    scope:
      "owned-fixture-native-transport-declared-FDs-and-PID-time-unified-logs",
    mediaCount: 0,
    semanticPassed: true,
    nativeWindow: options.nativeWindow,
  });
  await writeFile(
    path.join(root, phase + "-proof.json"),
    JSON.stringify(proof),
    { flag: "wx", mode: 0o600 },
  );
  return proof;
}

async function verifyRaw(proof: z.infer<typeof PhaseProofSchema>) {
  await ownedDirectory(proof.directory);
  await ownedDirectory(path.join(proof.directory, "guest"));
  const actual: string[] = [];
  for (const name of await readdir(proof.directory)) {
    if (name === "guest") {
      for (const child of await readdir(path.join(proof.directory, name)))
        actual.push(name + "/" + child);
    } else actual.push(name);
  }
  assert.deepEqual(
    actual.sort(),
    Object.keys(proof.raw).sort(),
    "Mac raw privacy inventory changed",
  );
  const bytesByName: Record<string, Uint8Array> = {};
  for (const [name, expected] of Object.entries(proof.raw)) {
    const bytes = await ownedBytes(
      path.join(proof.directory, name),
      8 * 1024 * 1024,
    );
    assert.equal(bytes.length, expected.size);
    assert.equal(digest(bytes), expected.sha256);
    bytesByName[name] = bytes;
  }
  const stdout = bytesByName["native.stdout"],
    stderr = bytesByName["native.stderr"];
  assert.ok(stdout && stderr);
  const guestFiles = Object.fromEntries(
    Object.entries(bytesByName)
      .filter(([name]) => name.startsWith("guest/"))
      .map(([name, bytes]) => [name.slice(6), bytes]),
  );
  validateMacMeasuredOutputs({
    prepared: proof.prepared,
    nativeStdout: stdout,
    nativeStderr: stderr,
    guestFiles,
    nativeWindow: proof.nativeWindow,
  });
}
export async function verifyMacInputPhasePair(manifest: GuestManifest) {
  const current = await binding(manifest),
    root = macInputProofRoot(manifest);
  await ownedDirectory(root);
  await ownedDirectory(path.join(root, "probes"));
  const files = ["credentials", "verification"] as const;
  const proofs = [];
  const hashes: string[] = [];
  for (const phase of files) {
    const bytes = await ownedBytes(path.join(root, phase + "-proof.json"));
    const proof = PhaseProofSchema.parse(JSON.parse(bytes.toString()));
    assert.equal(proof.phase, phase);
    assert.deepEqual(proof.binding, current);
    assert.equal(
      proof.directory,
      path.join(root, "probes", proof.prepared.input.sessionID),
    );
    assert.equal(proof.prepared.input.runID, manifest.runID);
    assert.equal(proof.prepared.probe, true);
    assert.equal(
      proof.prepared.input.operation,
      phase === "credentials" ? "credentials-probe" : "verification-probe",
    );
    assert.equal(proof.prepared.input.protocolSHA256, current.protocolSHA256);
    assert.equal(proof.prepared.input.timingSHA256, current.timingSHA256);
    await verifyRaw(proof);
    proofs.push(proof);
    hashes.push(digest(bytes));
  }
  const [credentials, verification] = proofs;
  assert.ok(credentials && verification);
  for (const key of [
    "helperSHA256",
    "protocolSHA256",
    "timingSHA256",
    "guestConfigSHA256",
  ] as const)
    assert.equal(
      credentials.prepared.input[key],
      verification.prepared.input[key],
    );
  assert.equal(
    credentials.prepared.input.guestConfigSHA256,
    manifest.execution.guestConfigSHA256,
  );
  assert.notEqual(
    credentials.prepared.input.sessionID,
    verification.prepared.input.sessionID,
  );
  const [credentialsProofSHA256, verificationProofSHA256] = hashes;
  assert.ok(credentialsProofSHA256 && verificationProofSHA256);
  return {
    current,
    input: credentials.prepared.input,
    credentialsProofSHA256,
    verificationProofSHA256,
  };
}
export async function createMacInputApproval(manifest: GuestManifest) {
  const pair = await verifyMacInputPhasePair(manifest),
    root = macInputProofRoot(manifest);
  const measurement = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      binding: pair.current,
      credentialsProofSHA256: pair.credentialsProofSHA256,
      verificationProofSHA256: pair.verificationProofSHA256,
    }),
  );
  await writeFile(path.join(root, "pair-measurement.json"), measurement, {
    flag: "wx",
    mode: 0o600,
  });
  const approval = MacInputApprovalSchema.parse({
    schemaVersion: 1,
    kind: "mac-private-account-input-approval",
    runID: manifest.runID,
    guestConfigSHA256: pair.current.guestConfigSHA256,
    helperSHA256: pair.input.helperSHA256,
    protocolSHA256: pair.input.protocolSHA256,
    timingSHA256: pair.input.timingSHA256,
    credentialsProofSHA256: pair.credentialsProofSHA256,
    verificationProofSHA256: pair.verificationProofSHA256,
    measurementSHA256: digest(measurement),
    credentialsPassed: true,
    verificationPassed: true,
  });
  await writeFile(
    path.join(root, "private-input-approved.json"),
    JSON.stringify(approval),
    { flag: "wx", mode: 0o600 },
  );
  return approval;
}
export async function requireMacInputApproval(manifest: GuestManifest) {
  const pair = await verifyMacInputPhasePair(manifest),
    root = macInputProofRoot(manifest);
  const approvalBytes = await ownedBytes(
    path.join(root, "private-input-approved.json"),
  );
  const approval = MacInputApprovalSchema.parse(
    JSON.parse(approvalBytes.toString()),
  );
  assert.equal(approval.runID, manifest.runID);
  assert.equal(
    approval.guestConfigSHA256,
    manifest.execution.guestConfigSHA256,
  );
  assert.equal(approval.credentialsProofSHA256, pair.credentialsProofSHA256);
  assert.equal(approval.verificationProofSHA256, pair.verificationProofSHA256);
  for (const key of ["helperSHA256", "protocolSHA256", "timingSHA256"] as const)
    assert.equal(approval[key], pair.input[key]);
  const measurement = await ownedBytes(
    path.join(root, "pair-measurement.json"),
  );
  assert.equal(approval.measurementSHA256, digest(measurement));
  assert.deepEqual(JSON.parse(measurement.toString()), {
    schemaVersion: 1,
    binding: pair.current,
    credentialsProofSHA256: pair.credentialsProofSHA256,
    verificationProofSHA256: pair.verificationProofSHA256,
  });
  return approval;
}
