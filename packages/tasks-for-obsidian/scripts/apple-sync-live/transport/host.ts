import assert from "node:assert/strict";
import { guestBootstrap } from "./execution/bootstrap-code.ts";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import {
  GuestExecutionSchema,
  GuestFailureSchema,
  GuestReplySchema,
  GuestRequestSchema,
  type GuestExecution,
  type GuestOperation,
  type GuestResult,
} from "./contract.ts";
import { contentSHA, maximumWireBytes } from "./fields.ts";

export type GuestManifest = {
  schemaVersion: 3;
  execution: GuestExecution;
  runID: string;
  round: number;
  allowedRemoteVaultID: string | null;
};
export type TransportCommand = (
  argv: string[],
  input: Uint8Array,
  timeoutMS: number,
) => Promise<{
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
}>;
const packageRoot = path.resolve(import.meta.dir, "../../..");
const guestBun = "/Volumes/My Shared Files/tools/bun";
const bootstrap = `try { ${guestBootstrap("runGuestTransport")} } catch { console.log(JSON.stringify({schemaVersion:1,outcome:"rejected",reason:"binding"})); process.exitCode=1; }`;

async function boundedBytes(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
): Promise<Uint8Array> {
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum)
        throw new Error("Guest transport output exceeded its bound");
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Only pipe memory crosses the Guest Agent. Neither input nor child diagnostics become evidence. */
export const executePrivateTransport: TransportCommand = async (
  argv,
  input,
  timeoutMS,
) => {
  const environment: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "DEVELOPER_DIR",
    "LANG",
    "USER",
    "LOGNAME",
  ])
    if (Bun.env[key] !== undefined) environment[key] = Bun.env[key];
  const child = Bun.spawn(argv, {
    env: environment,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  let expired = false;
  let stopSubmitted = false;
  const stillRunning = () => child.exitCode === null;
  const stop = () => {
    if (stopSubmitted || !stillRunning()) return;
    stopSubmitted = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      if (stillRunning()) child.kill("SIGKILL");
    }
  };
  const timer = setTimeout(() => {
    expired = true;
    stop();
  }, timeoutMS);
  try {
    await child.stdin.write(input);
    await child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      boundedBytes(child.stdout, maximumWireBytes),
      boundedBytes(child.stderr, 1024 * 1024),
      child.exited,
    ]);
    assert.equal(expired, false, "Guest transport exceeded its deadline");
    return { stdout, stderr, exitCode };
  } catch {
    stop();
    await child.exited;
    throw new Error(
      "Private guest transport failed; submission outcome is unknown",
    );
  } finally {
    clearTimeout(timer);
  }
};

async function pinnedExport(execution: GuestExecution): Promise<void> {
  const directory = path.resolve(
    packageRoot,
    "../tasknotes-macos/.build/occurrence-vm/exports",
    execution.artifactBuildID,
  );
  assert.equal(await realpath(directory), directory);
  for (const [name, expected] of [
    ["live-guest.js", execution.guestBundleSHA256],
    ["live-config.json", execution.guestConfigSHA256],
    ["artifact.json", execution.artifactSHA256],
    ["payload.json", execution.payloadSHA256],
  ]) {
    assert.ok(name && expected);
    const file = path.join(directory, name),
      metadata = await lstat(file);
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === process.getuid?.() &&
        (metadata.mode & 0o022) === 0,
    );
    assert.equal(
      contentSHA(await Bun.file(file).bytes()),
      expected,
      "Guest export identity changed",
    );
  }
}

export async function guestCall(
  manifest: GuestManifest,
  operation: GuestOperation,
  execute: TransportCommand = executePrivateTransport,
  verifyExport: (execution: GuestExecution) => Promise<void> = pinnedExport,
): Promise<GuestResult> {
  assert.equal(manifest.schemaVersion, 3);
  const execution = GuestExecutionSchema.parse(manifest.execution);
  assert.equal(execution.guestRunID, manifest.runID);
  const validated = GuestRequestSchema.safeParse({
    schemaVersion: 1,
    binding: {
      runID: manifest.runID,
      round: manifest.round,
      allowedRemoteVaultID: manifest.allowedRemoteVaultID,
    },
    requestID: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    operation,
  });
  if (!validated.success) throw new Error("Invalid private guest request");
  const request = validated.data;
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  assert.ok(bytes.length <= maximumWireBytes);
  await verifyExport(execution);
  const result = await execute(
    [
      "tart",
      "exec",
      "-i",
      execution.vm,
      guestBun,
      "-e",
      bootstrap,
      execution.guestBundlePath,
      execution.guestBundleSHA256,
      execution.guestConfigSHA256,
      execution.artifactSHA256,
      execution.payloadSHA256,
    ],
    bytes,
    operation.kind === "native" ? 660_000 : 180_000,
  );
  // Never expose Zod input, account values, or raw child diagnostics on a rejected request.
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
    );
  } catch {
    throw new Error(
      "Guest returned an invalid private reply; outcome is unknown",
    );
  }
  const failure = GuestFailureSchema.safeParse(decoded);
  if (failure.success)
    throw new Error(
      `Guest transport rejected operation: ${failure.data.reason}`,
    );
  if (result.exitCode !== 0 || result.stderr.length > 0)
    throw new Error("Guest command failed; submission outcome is unknown");
  const parsed = GuestReplySchema.safeParse(decoded);
  if (!parsed.success)
    throw new Error("Guest reply failed its closed contract");
  assert.deepEqual(
    parsed.data.binding,
    request.binding,
    "Guest reply binding mismatch",
  );
  assert.equal(
    parsed.data.requestID,
    request.requestID,
    "Guest reply belongs to another request",
  );
  assert.equal(
    parsed.data.result.kind,
    request.operation.kind,
    "Guest reply belongs to another operation",
  );
  const age = Date.now() - Date.parse(parsed.data.capturedAt);
  assert.ok(age >= -1000 && age <= 5000, "Guest reply is stale");
  await verifyExport(execution);
  return parsed.data.result;
}
