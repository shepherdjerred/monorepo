import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { collectSourceCache } from "./source-cache-gc.ts";
const { join } = nodePath;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ci-source-gc-test-"));
  roots.push(root);
  return root;
}
async function entry(root: string, sha: string, touched: number) {
  const path = join(root, "v1", "a".repeat(64), sha.repeat(40));
  await mkdir(path, { recursive: true });
  await Bun.write(join(path, "objects"), "1234567890");
  await utimes(path, touched / 1000, touched / 1000);
  return path;
}
test("fresh volumes need no cleanup; retention and capacity evict oldest entries", async () => {
  const root = await fixture();
  expect(await collectSourceCache(root)).toEqual({
    removed: 0,
    retainedBytes: 0,
  });
  const now = Date.now();
  await entry(root, "1", now - 8 * 24 * 60 * 60 * 1000);
  await entry(root, "2", now - 1000);
  const newest = await entry(root, "3", now);
  expect(await collectSourceCache(root, now, 10)).toEqual({
    removed: 2,
    retainedBytes: 10,
  });
  expect(await Bun.file(join(newest, "objects")).text()).toBe("1234567890");
});
test("unexpected names and symlinks fail before deleting a target", async () => {
  const root = await fixture();
  const path = await entry(root, "1", Date.now());
  await symlink(root, join(path, "outside"));
  await expect(collectSourceCache(root, Date.now(), 0)).rejects.toThrow(
    "symlinks",
  );
  expect(await Bun.file(join(path, "objects")).text()).toBe("1234567890");
});
