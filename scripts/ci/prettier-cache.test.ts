import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { preparePrettierCache, prettierCacheKey } from "./prettier-cache.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "prettier-cache-test-"));
  roots.push(root);
  for (const [name, contents] of Object.entries({
    "package.json": '{"name":"fixture"}',
    "bun.lock": "locked plugin",
    ".prettierrc.json": '{"semi":true}',
  }))
    await Bun.write(path.join(root, name), contents);
  for (const args of [
    ["init", "--quiet"],
    ["add", "package.json", "bun.lock", ".prettierrc.json"],
  ]) {
    const child = Bun.spawnSync(["git", ...args], { cwd: root });
    if (child.exitCode !== 0) throw new Error("Fixture git failed");
  }
  const shared = path.join(root, "shared");
  await mkdir(shared);
  return { root, shared };
}
test("formatter configuration and locked plugin changes invalidate content results", async () => {
  const { root } = await fixture();
  const first = await prettierCacheKey(root);
  await Bun.write(path.join(root, ".prettierrc.json"), '{"semi":false}');
  const second = await prettierCacheKey(root);
  expect(second).not.toBe(first);
  await Bun.write(path.join(root, "bun.lock"), "upgraded plugin");
  expect(await prettierCacheKey(root)).not.toBe(second);
});
test("concurrent jobs publish atomically and keep private cache files", async () => {
  const { root, shared } = await fixture();
  const [a, b] = await Promise.all([
    preparePrettierCache(root, shared, "root"),
    preparePrettierCache(root, shared, "root"),
  ]);
  expect(a.restored).toBe(false);
  expect(b.restored).toBe(false);
  const aFile = a.args.at(-1);
  const bFile = b.args.at(-1);
  if (aFile === undefined || bFile === undefined)
    throw new Error("Missing private path");
  expect(aFile).not.toBe(bFile);
  await Bun.write(aFile, '{"writer":"a"}');
  await Bun.write(bFile, '{"writer":"b"}');
  await Promise.all([a.publish(), b.publish()]);
  await Promise.all([a.cleanup(), b.cleanup()]);
  const reader = await preparePrettierCache(root, shared, "root");
  expect(reader.restored).toBe(true);
  const file = reader.args.at(-1);
  if (file === undefined) throw new Error("Missing reader path");
  const cached = z
    .object({ writer: z.string() })
    .parse(await Bun.file(file).json());
  expect(["a", "b"]).toContain(cached.writer);
  expect(reader.args).toContain("content");
  await reader.cleanup();
});

test("a restored content cache accepts changed mtimes and rejects changed formatting", async () => {
  const { root, shared } = await fixture();
  const source = path.join(root, "source.js");
  await Bun.write(source, "const value = 1;\n");
  const cli = Bun.resolveSync("prettier/bin/prettier.cjs", import.meta.dir);
  const run = (args: string[]) =>
    Bun.spawnSync([process.execPath, cli, "--check", ...args, "source.js"], {
      cwd: root,
    });
  const producer = await preparePrettierCache(root, shared, "root");
  expect(producer.restored).toBe(false);
  expect(run(producer.args).exitCode).toBe(0);
  await producer.publish();
  await producer.cleanup();
  await utimes(source, new Date(0), new Date(0));
  const consumer = await preparePrettierCache(root, shared, "root");
  expect(consumer.restored).toBe(true);
  expect(run(consumer.args).exitCode).toBe(0);
  await Bun.write(source, "const value=1");
  expect(run(consumer.args).exitCode).toBe(1);
  await consumer.cleanup();
});
