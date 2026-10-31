import { expect, test } from "vitest";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  symlink,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { closedFailure, PrivatePhaseFailure } from "./failure";
import { hasCheckpointFile, readPrivatePhaseBytes } from "./checkpoint";
import { AppInputFrames } from "./app-frames";

test("primary typed deadline survives cleanup fallback without raw error reflection", () => {
  const result = closedFailure(
    new PrivatePhaseFailure("deadline", "verification"),
    { kind: "cleanup", phase: "cleanup" },
    { elapsedMilliseconds: 120_010, deadlineRemainingMilliseconds: -10 },
  );
  expect(result).toEqual({
    kind: "deadline",
    phase: "verification",
    elapsedMilliseconds: 120_010,
    deadlineRemainingMilliseconds: -10,
  });
  const raw = "public-marker-not-for-diagnostics";
  expect(
    JSON.stringify(
      closedFailure(
        new Error(raw),
        { kind: "internal", phase: "connect" },
        { elapsedMilliseconds: 1, deadlineRemainingMilliseconds: 119_999 },
      ),
    ),
  ).not.toContain(raw);
});
test("owner metadata uses no-follow exact private file reads", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-phase-owner-")),
  );
  try {
    const file = path.join(root, "metadata.json"),
      alias = path.join(root, "alias.json");
    await writeFile(file, '{"public":true}', { mode: 0o600 });
    expect(await readPrivatePhaseBytes(file)).toEqual(await readFile(file));
    await symlink(file, alias);
    expect(await hasCheckpointFile(alias)).toBe(true);
    await expect(readPrivatePhaseBytes(alias)).rejects.toThrow();
    const dangling = path.join(root, "dangling.json");
    await symlink(path.join(root, "missing.json"), dangling);
    expect(await hasCheckpointFile(dangling)).toBe(true);
    expect(await hasCheckpointFile(path.join(root, "missing.json"))).toBe(
      false,
    );
    await chmod(file, 0o644);
    await expect(readPrivatePhaseBytes(file)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true });
  }
});
test("private byte pump rejects the original expired deadline before reading", async () => {
  let reads = 0;
  const frames = new AppInputFrames(
    {
      read: async () => {
        reads++;
        return { done: true };
      },
    },
    () => performance.now() - 1,
    () => "verification",
    async () => {
      throw new Error("unexpected EOF");
    },
  );
  await expect(frames.next()).rejects.toMatchObject({
    kind: "deadline",
    phase: "verification",
  });
  expect(reads).toBe(0);
});
test("private byte pump decodes coalesced frames and retains fixed EOF classification", async () => {
  let reads = 0,
    rejections = 0;
  const frames = new AppInputFrames(
    {
      read: async () =>
        ++reads === 1
          ? { done: false, value: Buffer.from('{"public":1}\n{"public":2}\n') }
          : { done: true },
    },
    () => performance.now() + 1000,
    () => "connect",
    async () => {
      rejections++;
    },
  );
  expect(await frames.next()).toEqual({ public: 1 });
  expect(await frames.next()).toEqual({ public: 2 });
  await expect(frames.next()).rejects.toMatchObject({
    kind: "socket",
    phase: "connect",
  });
  expect(rejections).toBe(1);
});
