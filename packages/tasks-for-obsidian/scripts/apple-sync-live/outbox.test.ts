import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "vitest";
import { fingerprintOutbox } from "./outbox";

const profileID = "1d09432f-45c4-4392-a320-3ac199963410";
const databases: Database[] = [];
afterEach(() => {
  for (const connection of databases.splice(0)) connection.close();
});
function database() {
  const value = new Database(":memory:");
  databases.push(value);
  value.run(`PRAGMA user_version=16;
    CREATE TABLE profiles(id TEXT PRIMARY KEY);
    CREATE TABLE outbox(sequence INTEGER,profile TEXT,id TEXT,path TEXT,bytes TEXT,revision TEXT,remote_revision TEXT,created_ms INTEGER,modified_ms INTEGER,related_path TEXT);
    CREATE TABLE transfer_payloads(row_id INTEGER,profile TEXT,id TEXT,size INTEGER,revision TEXT,bytes BLOB);
    CREATE TABLE transfer_payload_state(row_id INTEGER,written INTEGER,sealed INTEGER);`);
  value.query("INSERT INTO profiles VALUES(?)").run(profileID);
  const revision = "a".repeat(64);
  value
    .query(
      "INSERT INTO outbox VALUES(1,?,'op-original','Tasks/Synthetic.md','payload',?,NULL,1,2,NULL)",
    )
    .run(profileID, revision);
  value
    .query("INSERT INTO transfer_payloads VALUES(1,?,'payload',1,?,x'41')")
    .run(profileID, revision);
  value.run("INSERT INTO transfer_payload_state VALUES(1,1,1)");
  return value;
}
test("outbox digest catches replacement operations despite equal pending counts", () => {
  const value = database();
  const before = fingerprintOutbox(value, profileID);
  expect(fingerprintOutbox(value, profileID)).toEqual(before);
  value.run("UPDATE outbox SET id='op-replaced'");
  const changed = fingerprintOutbox(value, profileID);
  expect(changed.count).toBe(before.count);
  expect(changed.sha256).not.toBe(before.sha256);
});
test("outbox digest includes immutable payload fingerprints and exact metadata", () => {
  const value = database();
  const before = fingerprintOutbox(value, profileID);
  const revision = "b".repeat(64);
  value.query("UPDATE outbox SET revision=?").run(revision);
  value.query("UPDATE transfer_payloads SET revision=?").run(revision);
  expect(fingerprintOutbox(value, profileID).sha256).not.toBe(before.sha256);
  value.run("UPDATE outbox SET related_path='Tasks/Other.md'");
  expect(fingerprintOutbox(value, profileID).sha256).not.toBe(before.sha256);
});
test("outbox snapshots fail closed on owner and missing or unsealed payloads", () => {
  const value = database();
  expect(() => fingerprintOutbox(value, crypto.randomUUID())).toThrow();
  value.run("UPDATE transfer_payload_state SET sealed=0");
  expect(() => fingerprintOutbox(value, profileID)).toThrow();
  value.run("DELETE FROM transfer_payloads");
  expect(() => fingerprintOutbox(value, profileID)).toThrow();
});

test("outbox snapshots require the current native schema and reject incompatible versions", () => {
  const value = database();
  expect(fingerprintOutbox(value, profileID).count).toBe(1);
  for (const version of [12, 15, 17]) {
    value.run(`PRAGMA user_version=${String(version)}`);
    expect(() => fingerprintOutbox(value, profileID)).toThrow();
  }
  value.run("PRAGMA user_version=16");
  expect(fingerprintOutbox(value, profileID).count).toBe(1);
});

test("a current version does not admit a missing payload ownership column", () => {
  const value = database();
  value.run("ALTER TABLE transfer_payload_state DROP COLUMN sealed");
  expect(() => fingerprintOutbox(value, profileID)).toThrow();
});
