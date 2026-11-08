import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as handles from "tasknotes-macos/scripts/apple-acceptance/owned-handle.ts";
import { readOwnedBytes, readOwnedPublication } from "./owned-files.ts";
import {
  binding,
  dispatcherOptions,
  emptyStatus,
  guestDirectories,
} from "./fixtures.test-support.ts";
import { createGuestDispatcher } from "./guest.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

async function publishedFile() {
  const { paths } = await guestDirectories(roots, "facet-owned-publication-");
  await mkdir(path.join(paths.stateDirectory, "control"));
  const file = path.join(paths.stateDirectory, "control/status.json");
  return { paths, file };
}

function duringRead(change: () => Promise<void>) {
  const read = handles.readExactHandle;
  vi.spyOn(handles, "readExactHandle").mockImplementation(async (...args) => {
    const bytes = await read(...args);
    await change();
    return bytes;
  });
}

async function replace(file: string, value: unknown) {
  const next = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(next, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  await rename(next, file);
}

test("status dispatcher accepts a coherent owned snapshot across atomic publication", async () => {
  const { paths, file } = await publishedFile();
  const old = emptyStatus(),
    next = { ...old, accountBusy: true };
  await writeFile(file, JSON.stringify(old));
  duringRead(() => replace(file, next));
  const reply = await createGuestDispatcher(dispatcherOptions(paths))({
    schemaVersion: 1,
    binding,
    requestID: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    operation: { kind: "status" },
  });
  expect(reply).toMatchObject({ result: { kind: "status", status: old } });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(next);
});

test("atomic publication does not relax stable vault or evidence pathname fencing", async () => {
  const { paths, file } = await publishedFile();
  await writeFile(file, "old");
  duringRead(() => replace(file, "new"));
  await expect(
    readOwnedBytes(paths.stateDirectory, "control/status.json"),
  ).rejects.toThrow();
});

test("publication still rejects in-place partial writes and corrupt shared-schema status", async () => {
  const { paths, file } = await publishedFile();
  await writeFile(file, "intact initial publication");
  duringRead(() => writeFile(file, "{"));
  await expect(
    readOwnedPublication(paths.stateDirectory, "control/status.json"),
  ).rejects.toThrow();
  vi.restoreAllMocks();
  const reply = await createGuestDispatcher(dispatcherOptions(paths))({
    schemaVersion: 1,
    binding,
    requestID: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    operation: { kind: "status" },
  });
  expect(reply).toMatchObject({ outcome: "rejected", reason: "operation" });
});
