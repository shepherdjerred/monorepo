import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { ContentProof } from "./content-proof.ts";
import { sha256File } from "./operations-io.ts";
import { FileOperations } from "./operations.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await realpath(
    await mkdtemp(nodePath.join(tmpdir(), "media-content-proof-")),
  );
  directories.push(directory);
  const source = nodePath.join(directory, "source");
  const target = nodePath.join(directory, "target");
  await writeFile(source, "verified source");
  const proof = new ContentProof();
  await proof.capture(source, () => Promise.resolve());
  await proof.capture(target, () => Promise.resolve());
  proof.seal();
  return { directory, source, target, proof };
}

test("known hardlink and unlink transitions preserve exact content proofs for surviving aliases", async () => {
  const { source, target, proof } = await fixture();
  const digest = await sha256File(source);
  await proof.link(source, target);
  expect(await proof.digest(source)).toBe(digest);
  expect(await proof.digest(target)).toBe(digest);
  await proof.unlink(source);
  expect(await proof.digest(source)).toBeNull();
  expect(await proof.digest(target)).toBe(digest);
});

test("same-size writes after verification are never blessed by a later hardlink", async () => {
  const { source, target, proof } = await fixture();
  await writeFile(source, "altered! source");
  await expect(proof.link(source, target)).rejects.toThrow("identity changed");
});

test("absent-path evidence rejects a new file and a replaced parent directory", async () => {
  const { directory, target, proof } = await fixture();
  await writeFile(target, "foreign");
  await expect(proof.digest(target)).rejects.toThrow("absent media path");
  const parent = nodePath.join(directory, "parent");
  await mkdir(parent);
  const absent = nodePath.join(parent, "absent");
  const other = new ContentProof();
  await other.capture(absent, () => Promise.resolve());
  other.seal();
  await rename(parent, `${parent}-old`);
  await mkdir(parent);
  await expect(other.digest(absent)).rejects.toThrow("ancestor changed");
});

test("proofs cannot admit newly discovered paths or be renewed after authority begins", async () => {
  const { directory, source, proof } = await fixture();
  await expect(
    proof.digest(nodePath.join(directory, "unknown")),
  ).rejects.toThrow("no preverified");
  expect(() => {
    proof.seal();
  }).toThrow("cannot be renewed");
  await expect(proof.capture(source, () => Promise.resolve())).rejects.toThrow(
    "already sealed",
  );
});

async function purgeFixture() {
  const f = await fixture();
  const roots = {
    downloads: nodePath.join(f.directory, "downloads"),
    library: nodePath.join(f.directory, "library"),
    control: nodePath.join(f.directory, "control"),
  };
  for (const path of Object.values(roots)) await mkdir(path);
  const parent = nodePath.join(roots.control, "quarantine");
  await mkdir(parent);
  const source = nodePath.join(parent, "owned");
  await writeFile(source, "verified source");
  const input = {
    operationId: "purge-test",
    quarantineId: "owned",
    sha256: await sha256File(source),
  };
  return { roots, parent, source, input };
}

test.each([
  ["prepared", "parent"],
  ["prepared", "leaf"],
  ["complete", "parent"],
  ["complete", "leaf"],
] as const)(
  "%s purge cannot acknowledge absence after captured %s identity changes",
  async (phase, changed) => {
    const f = await purgeFixture();
    const initial = new FileOperations(f.roots, {
      authorize: () =>
        phase === "prepared"
          ? Promise.reject(new Error("interrupted"))
          : Promise.resolve(),
    });
    if (phase === "prepared")
      await expect(initial.purge(f.input)).rejects.toThrow("interrupted");
    else {
      await initial.purge(f.input);
      await writeFile(f.source, "verified source");
    }
    const proof = new ContentProof();
    await proof.capture(f.source, () => Promise.resolve());
    proof.seal();
    if (changed === "parent") {
      await rename(f.parent, `${f.parent}-old`);
      await mkdir(f.parent);
    } else await rename(f.source, `${f.source}-old`);
    const operations = new FileOperations(f.roots, {
      authorize: () => Promise.resolve(),
      contentProof: proof,
    });
    await expect(operations.purge(f.input)).rejects.toThrow();
    const journal = await operations.readManifest(f.input.operationId);
    expect(journal?.phase).toBe(phase);
  },
);

test("interrupted purge accepts an originally proven absent source and completes idempotently", async () => {
  const f = await purgeFixture();
  const initial = new FileOperations(f.roots, {
    authorize: () => Promise.resolve(),
    checkpoint: (phase) =>
      phase === "purged"
        ? Promise.reject(new Error("interrupted"))
        : Promise.resolve(),
  });
  await expect(initial.purge(f.input)).rejects.toThrow("interrupted");
  const proof = new ContentProof();
  await proof.capture(f.source, () => Promise.resolve());
  proof.seal();
  const operations = new FileOperations(f.roots, {
    authorize: () => Promise.resolve(),
    contentProof: proof,
  });
  const completed = await operations.purge(f.input);
  const repeated = await operations.purge(f.input);
  expect(completed.phase).toBe("complete");
  expect(repeated.phase).toBe("complete");
});
