import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Snapshot, copyEvidence, hashFile } from "./archive.ts";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "rwf-promotion-archive-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("streams complete files, deduplicates evidence and refuses overwrites", async () => {
  const first = path.join(directory, "first");
  const second = path.join(directory, "second");
  const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
  await writeFile(first, bytes);
  await writeFile(second, bytes);
  const snapshot = new Snapshot();
  const digest = await snapshot.add(first);
  expect(digest).toBe(
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  );
  await snapshot.add(second, digest);
  const target = path.join(directory, "out");
  await mkdir(path.join(target, "evidence"), { recursive: true });
  const catalogue = await snapshot.archive(target);
  expect(catalogue).toEqual([
    { file: `evidence/${digest}.blob`, sha256: digest },
  ]);
  expect(await readFile(path.join(target, `evidence/${digest}.blob`))).toEqual(
    Buffer.from(bytes),
  );
  await expect(snapshot.archive(target)).rejects.toThrow();
  expect(await hashFile(path.join(target, `evidence/${digest}.blob`))).toBe(
    digest,
  );
});

it("does not let another expected digest replace the first snapshot", async () => {
  const source = path.join(directory, "source");
  await writeFile(source, "original unit bytes");
  const snapshot = new Snapshot();
  const digest = await snapshot.add(source);
  await writeFile(source, "changed unit bytes");
  await expect(snapshot.add(source, await hashFile(source))).rejects.toThrow(
    "first snapshot",
  );
  expect(snapshot.files()).toEqual([{ file: source, sha256: digest }]);
  await expect(snapshot.verify()).rejects.toThrow("evidence changed");
});

it("wrong hashes and invalid digests cannot create valid evidence", async () => {
  const source = path.join(directory, "source");
  await writeFile(source, "unit bytes");
  await expect(
    copyEvidence(source, path.join(directory, "wrong"), "a".repeat(64)),
  ).rejects.toThrow("copied promotion evidence differs");
  await expect(
    copyEvidence(source, path.join(directory, "invalid"), "../escape"),
  ).rejects.toThrow();
  await expect(readFile(path.join(directory, "invalid"))).rejects.toThrow();
});
