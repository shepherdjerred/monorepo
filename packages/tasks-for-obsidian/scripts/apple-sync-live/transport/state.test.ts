import { Database } from "bun:sqlite";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createGuestDispatcher } from "./guest.ts";
import {
  runID,
  binding,
  guestDirectories,
  dispatcherOptions,
} from "./fixtures.test-support.ts";
import { contentSHA } from "./fields.ts";

const profileID = "22345678-1234-4234-9234-123456789abc";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture() {
  const { paths } = await guestDirectories(roots, "facet-guest-state-");
  await mkdir(path.join(paths.stateDirectory, "control"));
  const status = {
    schemaVersion: 1,
    runID,
    capturedAt: new Date().toISOString(),
    accountBusy: false,
    accountStage: "credentials",
    accountExchange: null,
    profiles: [
      {
        profileID,
        remoteVaultID: binding.allowedRemoteVaultID,
        profileKind: "obsidian_sync",
        phase: "offline",
        transport: "offline",
        hostWorkPending: false,
        durable: {
          schemaVersion: 1,
          profileId: profileID,
          profileKind: "obsidian_sync",
          version: 1,
          initialSyncComplete: true,
          pendingRemoteCount: 0,
          pendingUploadCount: 1,
          pendingMutationCount: 0,
          conflictCount: 0,
        },
      },
    ],
  };
  await writeFile(
    path.join(paths.stateDirectory, "control/status.json"),
    JSON.stringify(status),
  );
  const options = dispatcherOptions(paths);
  return { paths, dispatch: createGuestDispatcher(options) };
}
function request(operation: unknown) {
  return {
    schemaVersion: 1,
    binding,
    issuedAt: new Date().toISOString(),
    requestID: crypto.randomUUID(),
    operation,
  };
}

test("outbox measurement returns only a read-only digest and enforces actual profile ownership", async () => {
  const { paths, dispatch } = await fixture(),
    file = path.join(paths.stateDirectory, "facet.sqlite3");
  const database = new Database(file);
  database.run(`PRAGMA user_version=12;
    CREATE TABLE profiles(id TEXT PRIMARY KEY);
    CREATE TABLE outbox(sequence INTEGER,profile TEXT,id TEXT,path TEXT,bytes TEXT,revision TEXT,remote_revision TEXT,created_ms INTEGER,modified_ms INTEGER,related_path TEXT);
    CREATE TABLE transfer_payloads(row_id INTEGER,profile TEXT,id TEXT,size INTEGER,revision TEXT,bytes BLOB);
    CREATE TABLE transfer_payload_state(row_id INTEGER,written INTEGER,sealed INTEGER);`);
  database.query("INSERT INTO profiles VALUES(?)").run(profileID);
  database
    .query(
      "INSERT INTO outbox VALUES(1,?,'private-operation','Tasks/private.md',NULL,NULL,NULL,1,2,NULL)",
    )
    .run(profileID);
  database.close();
  const before = contentSHA(await Bun.file(file).bytes());
  const reply = await dispatch(request({ kind: "outbox", profileID }));
  expect(reply).toMatchObject({
    result: { kind: "outbox", profileID, count: 1 },
  });
  expect(JSON.stringify(reply)).not.toContain("private-operation");
  expect(JSON.stringify(reply)).not.toContain("Tasks/private.md");
  expect(contentSHA(await Bun.file(file).bytes())).toBe(before);
  expect(
    await dispatch(request({ kind: "outbox", profileID: crypto.randomUUID() })),
  ).toMatchObject({ outcome: "rejected" });
  expect(
    await dispatch(
      request({ kind: "fileInfo", target: "evidence", path: "facet.sqlite3" }),
    ),
  ).toMatchObject({ outcome: "rejected" });
});

test("control completion requires the matching durable acknowledgement rather than an older result", async () => {
  const { paths, dispatch } = await fixture();
  const resultFile = path.join(paths.stateDirectory, "control/result.json");
  await writeFile(
    resultFile,
    JSON.stringify({
      schemaVersion: 1,
      runID,
      commandID: crypto.randomUUID(),
      outcome: "applied",
      classification: null,
    }),
  );
  let terminal: unknown;
  const pending = (async () => {
    const reply = await dispatch(
      request({ kind: "control", action: "resume", profileID }),
    );
    terminal = reply;
    return reply;
  })();
  const commandPath = path.join(paths.stateDirectory, "control/command.json");
  const deadline = Date.now() + 2000;
  while (!(await Bun.file(commandPath).exists())) {
    if (terminal) throw new Error(JSON.stringify(terminal));
    if (Date.now() > deadline) throw new Error("Control was not submitted");
    await Bun.sleep(1);
  }
  const command = await Bun.file(commandPath).json();
  expect(command).toMatchObject({ runID, kind: "resume", profileID });
  const nextResult = `${resultFile}.${crypto.randomUUID()}.tmp`;
  await writeFile(
    nextResult,
    JSON.stringify({
      schemaVersion: 1,
      runID,
      commandID: command.commandID,
      outcome: "applied",
      classification: null,
    }),
    { flag: "wx", mode: 0o600 },
  );
  await rename(nextResult, resultFile);
  expect(await pending).toMatchObject({
    result: {
      kind: "control",
      commandID: command.commandID,
      outcome: "applied",
    },
  });
});
