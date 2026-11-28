import {
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  defaultDispatchHandleDir,
  fileDispatchHandles,
  isDispatchHandle,
} from "#lib/incidents/dispatch-handles.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function store() {
  const root = await mkdtemp(path.join(tmpdir(), "incident-handles-"));
  directories.push(root);
  const dir = path.join(root, "toolkit/incident-dispatch");
  return { dir, handles: fileDispatchHandles(dir) };
}

test("a saved token is private to this user and readable once by its handle", async () => {
  const { dir, handles } = await store();
  const token = "q".repeat(32);

  const handle = await handles.save(token);

  expect(isDispatchHandle(handle)).toBe(true);
  expect(handle).not.toContain(token);
  const [directoryMode, fileMode] = await Promise.all([
    stat(dir),
    stat(path.join(dir, handle)),
  ]);
  expect(directoryMode.mode & 0o777).toBe(0o700);
  expect(fileMode.mode & 0o777).toBe(0o600);
  await expect(handles.read(handle)).resolves.toBe(token);
  await handles.remove(handle);
  await expect(handles.read(handle)).resolves.toBeNull();
});

test("handles cannot name paths outside the store", async () => {
  const { handles } = await store();
  expect(isDispatchHandle("../../etc/passwd")).toBe(false);
  await expect(handles.read("../../etc/passwd")).rejects.toThrow(
    /Not a dispatch handle/u,
  );
});

test("saving sweeps tokens left by sessions that never claimed", async () => {
  const { dir, handles } = await store();
  const old = await handles.save("o".repeat(32));
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await utimes(path.join(dir, old), dayAgo, dayAgo);
  await writeFile(path.join(dir, "fresh-handle-0000000"), "f");

  const kept = await handles.save("n".repeat(32));

  const names = await readdir(dir);
  expect(names.toSorted()).toEqual(["fresh-handle-0000000", kept].toSorted());
});

test("the store follows XDG_STATE_HOME", () => {
  expect(
    defaultDispatchHandleDir({ XDG_STATE_HOME: "/state" }, "/home/a"),
  ).toBe("/state/toolkit/incident-dispatch");
  expect(defaultDispatchHandleDir({}, "/home/a")).toBe(
    "/home/a/.local/state/toolkit/incident-dispatch",
  );
});
