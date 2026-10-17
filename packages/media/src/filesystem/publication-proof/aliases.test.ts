import { afterEach, expect, test } from "vitest";
import { mkdtemp, realpath, writeFile, rm, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentProof } from "#filesystem/content-proof.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("mutation audit includes captured inode aliases and excludes unrelated content", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-effect-alias-")),
  );
  directories.push(directory);
  const source = path.join(directory, "source");
  const alias = path.join(directory, "alias");
  const target = path.join(directory, "target");
  const other = path.join(directory, "other");
  await writeFile(source, "same bytes");
  await link(source, alias);
  await writeFile(other, "same bytes");
  const proof = new ContentProof();
  for (const name of [source, alias, target, other])
    await proof.capture(name, () => Promise.resolve());
  proof.seal();
  expect(await proof.mutationPaths([source, target])).toEqual(
    [alias, source, target].sort(),
  );
  await proof.link(source, target);
  expect(await proof.mutationPaths([target])).toEqual(
    [alias, source, target].sort(),
  );
  await proof.unlink(source);
  expect(await proof.mutationPaths([alias, source])).toEqual(
    [alias, source, target].sort(),
  );
  await expect(
    proof.mutationPaths([path.join(directory, "uncaptured")]),
  ).rejects.toThrow("no preverified");
});
