import { test, expect, afterAll } from "vitest";
import { mkdir, mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectHandoffJournals, verifyJournalProof } from "./journals.ts";

const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const control = await mkdtemp(path.join(tmpdir(), "media-handoff-journal-"));
  directories.push(control);
  await mkdir(path.join(control, "journal"));
  const manifest = {
    version: 1,
    operationId: "old-operation",
    kind: "import",
    source: "/downloads/old",
    target: "/movies/selected.mkv",
    sha256: "a".repeat(64),
    previousSha256: null,
    phase: "complete",
  };
  const filename = path.join(control, "journal", "old-operation.json");
  await writeFile(filename, JSON.stringify(manifest));
  return { control, manifest, filename };
}

test("completed external effect missing from restored PG remains explicit; in-place journal edits invalidate proof", async () => {
  const f = await fixture();
  const proof = await inspectHandoffJournals(
    f.control,
    new Set([f.manifest.target]),
  );
  expect(proof.files).toHaveLength(1);
  await expect(verifyJournalProof(proof)).resolves.toBeUndefined();
  await writeFile(
    f.filename,
    JSON.stringify({ ...f.manifest, sha256: "b".repeat(64) }),
  );
  await expect(verifyJournalProof(proof)).rejects.toThrow("identity changed");
});

test("pending selected effects protect while unrelated pending effects remain outside the explicit scope", async () => {
  const f = await fixture();
  await writeFile(
    f.filename,
    JSON.stringify({ ...f.manifest, phase: "prepared" }),
  );
  await expect(
    inspectHandoffJournals(f.control, new Set([f.manifest.target])),
  ).rejects.toThrow("unresolved filesystem effect");
  await expect(
    inspectHandoffJournals(f.control, new Set(["/movies/other.mkv"])),
  ).resolves.toMatchObject({ files: [] });
});

test("journal parent replacement invalidates authority even with identical manifests", async () => {
  const f = await fixture();
  const proof = await inspectHandoffJournals(
    f.control,
    new Set([f.manifest.target]),
  );
  await rename(
    path.join(f.control, "journal"),
    path.join(f.control, "previous-journal"),
  );
  await mkdir(path.join(f.control, "journal"));
  await writeFile(f.filename, JSON.stringify(f.manifest));
  await expect(verifyJournalProof(proof)).rejects.toThrow("journal changed");
});
