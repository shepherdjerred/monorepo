import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runDirectory } from "../../model";
import {
  type OfficialVerificationPreparedSchema,
  verificationFrame,
  verificationProtocol,
} from "./official-verification-protocol";
type Prepared = z.infer<typeof OfficialVerificationPreparedSchema>;
export type VerificationCapture = { stdout: Uint8Array; stderr: Uint8Array };
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const fields = [
  "runID",
  "configSHA256",
  "challengeID",
  "pid",
  "startSeconds",
  "startMicroseconds",
  "launchDate",
] as const;
function binding(prepared: Prepared) {
  return {
    ...Object.fromEntries(fields.map((key) => [key, prepared.input[key]])),
    binarySHA256: prepared.binarySHA256,
  };
}
function root(prepared: Prepared) {
  return path.join(
    runDirectory(z.uuid().parse(prepared.input["runID"])),
    "official-verification",
  );
}
function validateCapture(
  prepared: Prepared,
  capture: VerificationCapture,
  sessionID: string,
) {
  assert.equal(
    capture.stderr.length,
    0,
    "Official verification probe emitted diagnostics",
  );
  assert.ok(
    capture.stdout.length <= verificationProtocol.limits.frameBytes * 2,
  );
  assert.equal(
    Buffer.from(capture.stdout).includes(
      Buffer.from(verificationProtocol.probeCode),
    ),
    false,
    "Official verification probe leaked its public sentinel",
  );
  const lines = new TextDecoder("utf-8", { fatal: true })
    .decode(capture.stdout)
    .split("\n");
  assert.equal(lines.pop(), "");
  assert.equal(lines.length, 2);
  const ready = verificationFrame("ready", JSON.parse(lines[0] ?? ""));
  const finished = verificationFrame("finished", JSON.parse(lines[1] ?? ""));
  for (const frame of [ready, finished])
    for (const key of ["runID", "challengeID"] as const)
      assert.equal(frame[key], prepared.input[key]);
  for (const frame of [ready, finished])
    assert.equal(frame["sessionID"], sessionID);
  for (const key of [
    "pid",
    "startSeconds",
    "startMicroseconds",
    "launchDate",
  ] as const)
    assert.equal(ready[key], prepared.input[key]);
  assert.equal(finished["cleared"], true);
  assert.equal(finished["submitActionCount"], 0);
}
export async function retainVerificationMeasurement(
  prepared: Prepared,
  capture: VerificationCapture,
  passed: boolean,
  storage?: { rootDirectory: string },
) {
  let approved = passed;
  if (passed) {
    try {
      validateCapture(
        prepared,
        capture,
        z.uuid().parse(prepared.input["sessionID"]),
      );
    } catch {
      approved = false;
    }
  }
  const parent = storage?.rootDirectory ?? root(prepared);
  const directory = path.join(
    parent,
    "probes",
    z.uuid().parse(prepared.input["sessionID"]),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of [
    ["stdout", capture.stdout],
    ["stderr", capture.stderr],
  ] as const)
    await writeFile(path.join(directory, name), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  const record = {
    schemaVersion: 1,
    binding: binding(prepared),
    sessionID: prepared.input["sessionID"],
    directory,
    stdoutSHA256: hash(capture.stdout),
    stderrSHA256: hash(capture.stderr),
  };
  await writeFile(
    path.join(directory, "measurement.json"),
    JSON.stringify({ ...record, passed: approved }),
    { flag: "wx", mode: 0o600 },
  );
  if (approved)
    await writeFile(
      path.join(parent, "probe-approved.json"),
      JSON.stringify(record),
      { flag: "wx", mode: 0o600 },
    );
  if (passed && !approved)
    throw new Error("Official verification privacy measurement failed");
}
export async function requireVerificationMeasurement(
  prepared: Prepared,
  storage?: { rootDirectory: string },
) {
  const parent = storage?.rootDirectory ?? root(prepared);
  const approval = await readOwned(
    path.join(parent, "probe-approved.json"),
    16_384,
  );
  const record = z
    .strictObject({
      schemaVersion: z.literal(1),
      binding: z.record(z.string(), z.unknown()),
      sessionID: z.uuid(),
      directory: z.string(),
      stdoutSHA256: z.string().regex(/^[a-f0-9]{64}$/u),
      stderrSHA256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .parse(JSON.parse(approval.toString("utf8")));
  assert.deepEqual(record.binding, binding(prepared));
  assert.equal(record.directory, path.join(parent, "probes", record.sessionID));
  const stdout = await readOwned(
      path.join(record.directory, "stdout"),
      verificationProtocol.limits.frameBytes * 2,
    ),
    stderr = await readOwned(path.join(record.directory, "stderr"), 4096);
  assert.equal(hash(stdout), record.stdoutSHA256);
  assert.equal(hash(stderr), record.stderrSHA256);
  validateCapture(prepared, { stdout, stderr }, record.sessionID);
}
async function readOwned(file: string, maximum: number) {
  const metadata = await lstat(file);
  assert.ok(
    metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.() &&
      metadata.size <= maximum,
  );
  assert.equal(await realpath(file), file);
  return readFile(file);
}
