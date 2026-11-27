import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { expect, test } from "vitest";
import { createOpener, createSealer } from "#lib/brim/sync/crypto.ts";
import { createMemoryObjectStore } from "#lib/brim/sync/object-store.ts";
import { pushCaptureArchive } from "#lib/history/captures/archive-export.ts";
import { CaptureArchiveReader } from "#lib/history/captures/archive-reader.ts";
import { CaptureStore } from "#lib/history/captures/store.ts";

const NOW = new Date("2026-11-27T20:00:00.000Z");
const STARTED_AT = "2026-11-27T19:00:00.000Z";
const TOKEN = `sk-proj-${"z".repeat(55)}`;
const SESSION = {
  source: "codex-mirror",
  runtimeId: "same-story",
  workspace: "/repo",
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
} as const;

async function createCapture(file: string, machine: string): Promise<void> {
  const captures = await CaptureStore.open(file);
  try {
    const content = captures.putBlob(JSON.stringify({ machine, token: TOKEN }));
    captures.run(
      `INSERT INTO captures (
      flow_id, seq, connection_id, cli, transport, host, path, format,
      session_key, cwd, started_at, status, raw_request_hash
    ) VALUES (?, 1, ?, 'codex', 'http', 'example.com', '/responses', 'openai-responses',
      'same-story', '/repo', ?, 'ok', ?)`,
      machine,
      machine,
      STARTED_AT,
      content,
    );
    captures.run(`INSERT INTO captures (
      flow_id, seq, connection_id, cli, transport, host, path, format,
      session_key, cwd, started_at, status, raw_request_hash
    ) VALUES ('old', 2, 'old', 'codex', 'http', 'example.com', '/responses', 'openai-responses',
      'same-story', '/repo', '2026-10-01T19:00:00.000Z', 'ok', 'fake')`);
  } finally {
    captures.close();
  }
}

test("projects redacted captures, scopes mirrored requests by device, and republishes an expired object", async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "brim-capture-archive-test-"),
  );
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const store = createMemoryObjectStore();
  const identity = await generateIdentity();
  const seal = createSealer(await identityToRecipient(identity));

  async function upload(machineId: string) {
    return await pushCaptureArchive({
      store,
      seal,
      machineId,
      sourcePath: path.join(directory, `${machineId}.sqlite`),
      retentionDays: 30,
      now: NOW,
    });
  }
  await createCapture(path.join(directory, "macbook.sqlite"), "macbook");
  await createCapture(path.join(directory, "karpathy.sqlite"), "karpathy");
  expect(await upload("macbook")).toBeGreaterThan(0);
  expect(await upload("karpathy")).toBeGreaterThan(0);
  expect(await upload("macbook")).toBe(0);

  const reader = await CaptureArchiveReader.open({
    directory: path.join(directory, "mirror"),
    store,
    open: createOpener(identity),
  });
  onTestFinished(() => {
    reader.close();
  });
  await reader.refresh();

  const all = reader.list(null, { limit: 5, offset: 0 }, NOW);
  expect(all.captures).toHaveLength(2);
  const mac = reader.list(
    { ...SESSION, machineId: "macbook" },
    { limit: 5, offset: 0 },
    NOW,
  );
  const karpathy = reader.list(
    { ...SESSION, machineId: "karpathy" },
    { limit: 5, offset: 0 },
    NOW,
  );
  expect(mac.captures).toHaveLength(1);
  expect(karpathy.captures).toHaveLength(1);
  const macId = mac.captures[0]?.id;
  expect(macId).toBeDefined();
  expect(macId).not.toBe(karpathy.captures[0]?.id);
  const detail = reader.detail(macId ?? 0, NOW);
  expect(detail?.rawRequest).toMatchObject({ machine: "macbook" });
  expect(JSON.stringify(detail)).not.toContain(TOKEN);
  expect(JSON.stringify(detail)).toContain("REDACTED-");
  expect(
    reader.detail(macId ?? 0, new Date("2026-12-30T20:00:00.000Z")),
  ).toBeNull();

  const keys = await store.listKeys("captures/v1/macbook/");
  const snapshot = keys.find((key) => key.endsWith(".sqlite.age"));
  expect(snapshot).toBeDefined();
  if (snapshot === undefined) throw new Error("Snapshot was not written");
  await store.delete(snapshot);
  expect(await upload("macbook")).toBeGreaterThan(0);
  await reader.refresh();
  expect(reader.detail(macId ?? 0, NOW)?.rawRequest).toMatchObject({
    machine: "macbook",
  });

  for (const key of await store.listKeys("captures/v1/macbook/")) {
    await store.delete(key);
  }
  await reader.refresh();
  expect(reader.detail(macId ?? 0, NOW)).toBeNull();
  expect(reader.list(null, { limit: 5, offset: 0 }, NOW).captures).toHaveLength(
    1,
  );
  expect(
    await Bun.file(path.join(directory, "mirror", "macbook.sqlite")).exists(),
  ).toBe(false);
});
