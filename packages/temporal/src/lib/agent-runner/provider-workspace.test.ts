import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { prepareProviderWorkspace } from "./provider-workspace.ts";

test("transfers a private workspace and its files to the provider uid", async () => {
  const uid = process.getuid?.();
  if (uid === undefined)
    throw new Error("Provider workspace test requires a Unix uid");
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "provider-workspace-test-"),
  );
  const file = path.join(directory, "checkout.txt");
  try {
    await writeFile(file, "checkout", { mode: 0o600 });
    await prepareProviderWorkspace(directory, uid);
    const directoryStat = await stat(directory);
    const fileStat = await stat(file);
    expect(directoryStat.uid).toBe(uid);
    expect(fileStat.uid).toBe(uid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not run ownership changes for local development", async () => {
  await expect(
    prepareProviderWorkspace("unused", undefined),
  ).resolves.toBeUndefined();
});

test("rejects relative workspace targets", async () => {
  await expect(prepareProviderWorkspace("relative", 1001)).rejects.toThrow(
    "absolute path",
  );
});
