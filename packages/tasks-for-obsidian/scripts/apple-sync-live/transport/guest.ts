import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import {
  lstat,
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GuestFailureSchema } from "./contract.ts";
import {
  DataOperationSchema,
  GuestReplySchema,
  GuestRequestSchema,
  type GuestReply,
  type GuestRequest,
} from "./contract.ts";
import {
  GuestBindingSchema,
  maximumWireBytes,
  type GuestBinding,
  type GuestTarget,
} from "./fields.ts";
import {
  ExecutionOperationSchema,
  type ExecutionOperation,
  type ExecutionResult,
} from "./execution/contract.ts";
import {
  ownedDirectory,
  ownedPath,
  readOwnedBytes,
  readOwnedPublication,
  referenceApply,
  snapshot,
  type GuestPaths,
} from "./owned-files.ts";
import { fileChunk, fileInfo, stageReference } from "./chunks.ts";

export type GuestDispatcherOptions = {
  paths: GuestPaths;
  binding: GuestBinding | ((request: GuestRequest) => Promise<GuestBinding>);
  authorize: (request: GuestRequest) => Promise<void>;
  preflight: () => Promise<void>;
  execute: (
    operation: ExecutionOperation,
    request: GuestRequest,
  ) => Promise<ExecutionResult>;
};

async function status(paths: GuestPaths, binding: GuestBinding) {
  const { StatusSchema, validate } = await import("../model.ts");
  const raw: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readOwnedPublication(paths.stateDirectory, "control/status.json"),
    ),
  );
  validate("status", raw);
  const value = StatusSchema.parse(raw);
  assert.equal(value.runID.toLowerCase(), binding.runID.toLowerCase());
  const age = Date.now() - Date.parse(value.capturedAt);
  assert.ok(age >= -1000 && age <= 5000, "Guest application status is stale");
  for (const entry of value.profiles)
    assert.ok(
      entry.profileKind === "obsidian_sync" &&
        (entry.remoteVaultID === binding.allowedRemoteVaultID ||
          (entry.remoteVaultID === null &&
            entry.phase === "reconnectRequired")),
    );
  return { raw, value };
}

async function profile(
  paths: GuestPaths,
  binding: GuestBinding,
  profileID: string,
) {
  assert.ok(binding.allowedRemoteVaultID !== null);
  const { value } = await status(paths, binding),
    matching = value.profiles.filter((entry) => entry.profileID === profileID);
  assert.equal(value.profiles.length, 1);
  assert.equal(matching.length, 1);
  return profileID;
}

async function targetRoot(
  paths: GuestPaths,
  binding: GuestBinding,
  target: GuestTarget,
) {
  if (target === "official") return paths.referenceDirectory;
  if (target === "evidence") return paths.evidenceDirectory;
  await profile(paths, binding, target.profileID);
  const root = await ownedPath(
    paths.stateDirectory,
    `replicas/${target.profileID}/.guard`,
  );
  return path.dirname(root);
}

async function control(
  paths: GuestPaths,
  binding: GuestBinding,
  action: "refresh" | "interrupt" | "resume",
  profileID: string | undefined,
) {
  assert.ok(binding.allowedRemoteVaultID !== null);
  if (profileID !== undefined) await profile(paths, binding, profileID);
  const { atomicJSON, validate } = await import("../model.ts");
  const commandID = crypto.randomUUID();
  const command = {
    schemaVersion: 1,
    runID: binding.runID,
    commandID,
    kind: action,
    ...(profileID === undefined ? {} : { profileID }),
  };
  validate("command", command);
  const commandFile = await ownedPath(
    paths.stateDirectory,
    "control/command.json",
  );
  await atomicJSON(commandFile, command);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const raw: unknown = JSON.parse(
        new TextDecoder().decode(
          await readOwnedPublication(
            paths.stateDirectory,
            "control/result.json",
          ),
        ),
      );
      validate("result", raw);
      const result = z
        .object({
          runID: z.uuid(),
          commandID: z.uuid(),
          outcome: z.enum(["applied", "rejected"]),
        })
        .parse(raw);
      assert.equal(result.runID.toLowerCase(), binding.runID.toLowerCase());
      if (result.commandID === commandID) {
        assert.equal(result.outcome, "applied");
        return {
          kind: "control" as const,
          commandID,
          outcome: "applied" as const,
        };
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    await Bun.sleep(250);
  }
  throw new Error("Guest control acknowledgement exceeded its deadline");
}

async function dataOperation(
  options: GuestDispatcherOptions,
  request: GuestRequest,
  operation: z.infer<typeof DataOperationSchema>,
) {
  const { paths } = options,
    binding = request.binding;
  switch (operation.kind) {
    case "interruption": {
      assert.ok(binding.allowedRemoteVaultID !== null);
      const { validate } = await import("../model.ts");
      const raw: unknown = JSON.parse(
        new TextDecoder().decode(
          await readOwnedBytes(
            paths.stateDirectory,
            "control/interruption.json",
          ),
        ),
      );
      validate("interruption", raw);
      const interruption = z
        .strictObject({
          schemaVersion: z.literal(1),
          runID: z.uuid(),
          profileIDs: z.array(z.uuid()).max(1),
        })
        .parse(raw);
      assert.equal(
        interruption.runID.toLowerCase(),
        binding.runID.toLowerCase(),
      );
      return { kind: "interruption" as const, interruption };
    }
    case "status": {
      const current = await status(paths, binding);
      return { kind: "status" as const, status: current.raw };
    }
    case "snapshot":
      return {
        kind: "snapshot" as const,
        target: operation.target,
        files: await snapshot(
          await targetRoot(paths, binding, operation.target),
          operation.target === "evidence",
        ),
      };
    case "fileInfo":
      return {
        kind: "fileInfo" as const,
        target: operation.target,
        path: operation.path,
        fingerprint: await fileInfo(
          await targetRoot(paths, binding, operation.target),
          operation.path,
          operation.target === "evidence",
        ),
      };
    case "readFileChunk":
      return {
        kind: "readFileChunk" as const,
        target: operation.target,
        path: operation.path,
        expected: operation.expected,
        offset: operation.offset,
        blob: await fileChunk(
          await targetRoot(paths, binding, operation.target),
          operation,
        ),
      };
    case "outbox": {
      await profile(paths, binding, operation.profileID);
      const filename = await ownedPath(paths.stateDirectory, "facet.sqlite3");
      const metadata = await lstat(filename);
      assert.ok(
        metadata.isFile() &&
          !metadata.isSymbolicLink() &&
          metadata.uid === process.getuid?.(),
      );
      const database = new Database(filename, {
        readonly: true,
        create: false,
      });
      try {
        const { fingerprintOutbox } = await import("../outbox.ts");
        return {
          kind: "outbox" as const,
          profileID: operation.profileID,
          ...fingerprintOutbox(database, operation.profileID),
        };
      } finally {
        database.close();
      }
    }
    case "control":
      return control(paths, binding, operation.action, operation.profileID);
    case "referenceApply":
      return {
        kind: "referenceApply" as const,
        paths: await referenceApply(paths, operation.change, request.requestID),
      };
    case "referenceStage":
      return stageReference(paths, binding, operation, request.requestID);
  }
}

function mutating(request: GuestRequest): boolean {
  return ![
    "status",
    "interruption",
    "snapshot",
    "fileInfo",
    "readFileChunk",
    "outbox",
    "verify",
    "official-info",
    "official-publication",
  ].includes(request.operation.kind);
}
async function reserve(
  paths: GuestPaths,
  request: GuestRequest,
): Promise<() => Promise<void>> {
  const journal = await ownedPath(
    paths.evidenceDirectory,
    `transport-requests/${request.requestID}.json`,
    true,
  );
  // No action, password, generated code, file payload or request digest enters this journal.
  await writeFile(
    journal,
    JSON.stringify({
      schemaVersion: 1,
      runID: request.binding.runID,
      round: request.binding.round,
      requestID: request.requestID,
      kind: request.operation.kind,
      state: "started",
    }),
    { flag: "wx", mode: 0o600 },
  );
  const lease = path.join(paths.evidenceDirectory, "transport-lease");
  await mkdir(lease, { mode: 0o700 });
  const identity = await lstat(lease),
    token = path.join(lease, "owner.json");
  await writeFile(token, request.requestID, { flag: "wx", mode: 0o600 });
  return async () => {
    await ownedDirectory(lease);
    const actual = await lstat(lease),
      file = await lstat(token);
    assert.equal(actual.dev, identity.dev);
    assert.equal(actual.ino, identity.ino);
    assert.ok(
      file.isFile() &&
        !file.isSymbolicLink() &&
        file.uid === process.getuid?.(),
    );
    assert.equal(await readFile(token, "utf8"), request.requestID);
    await unlink(token);
    await rmdir(lease);
  };
}

/** Pure entrypoint for focused controls; production always supplies the real guest preflight. */
export function createGuestDispatcher(options: GuestDispatcherOptions) {
  return async (
    raw: unknown,
  ): Promise<GuestReply | z.infer<typeof GuestFailureSchema>> => {
    const parsed = GuestRequestSchema.safeParse(raw);
    if (!parsed.success)
      return { schemaVersion: 1, outcome: "rejected", reason: "request" };
    const request = parsed.data;
    let release: (() => Promise<void>) | undefined;
    let phase: z.infer<typeof GuestFailureSchema>["reason"] = "binding";
    try {
      const age = Date.now() - Date.parse(request.issuedAt);
      assert.ok(age >= -1000 && age <= 5000);
      await options.preflight();
      const expected = GuestBindingSchema.parse(
        typeof options.binding === "function"
          ? await options.binding(request)
          : options.binding,
      );
      assert.deepEqual(request.binding, expected);
      await options.authorize(request);
      phase = "ownership";
      await ownedDirectory(options.paths.stateDirectory);
      await ownedDirectory(options.paths.referenceDirectory);
      await ownedDirectory(options.paths.evidenceDirectory);
      if (mutating(request)) {
        phase = "duplicate";
        release = await reserve(options.paths, request);
      }
      phase = "operation";
      const data = DataOperationSchema.safeParse(request.operation);
      const result = data.success
        ? await dataOperation(options, request, data.data)
        : await options.execute(
            ExecutionOperationSchema.parse(request.operation),
            request,
          );
      // All status and execution values cross their complete producer-specific validators first.
      return GuestReplySchema.parse({
        schemaVersion: 1,
        binding: request.binding,
        requestID: request.requestID,
        capturedAt: new Date().toISOString(),
        result,
      });
    } catch {
      return { schemaVersion: 1, outcome: "rejected", reason: phase };
    } finally {
      if (release) await release();
    }
  };
}

/** Reads exactly one private request; failures never stringify input or thrown diagnostics. */
export async function serveGuestTransport(
  options: GuestDispatcherOptions,
): Promise<void> {
  try {
    const reader = Bun.stdin.stream().getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      assert.ok(size <= maximumWireBytes);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const input: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const reply = await createGuestDispatcher(options)(input);
    const output = JSON.stringify(reply);
    assert.ok(Buffer.byteLength(output) <= maximumWireBytes);
    console.log(output);
    if ("outcome" in reply) process.exitCode = 1;
  } catch {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        outcome: "rejected",
        reason: "operation",
      }),
    );
    process.exitCode = 1;
  }
}
