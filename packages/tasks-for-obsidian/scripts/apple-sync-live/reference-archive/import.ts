import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ArchiveSchema, archivePaths, type ArchiveInput } from "./contract";
import { assertCredentialFreeSettings } from "./settings";

const digest = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function privateEntry(filename: string, directory: boolean) {
  const metadata = await lstat(filename);
  if (
    (await realpath(filename)) !== filename ||
    metadata.uid !== process.getuid?.() ||
    (directory
      ? !metadata.isDirectory()
      : !metadata.isFile() || metadata.nlink !== 1) ||
    (metadata.mode & 0o777) !== (directory ? 0o700 : 0o600)
  )
    throw new Error(
      "Reference archive contains an unowned, linked or non-private entry",
    );
  return metadata;
}

async function inventory(root: string, relative = ""): Promise<string[]> {
  await privateEntry(path.join(root, relative), true);
  const files: string[] = [];
  const names = await readdir(path.join(root, relative));
  for (const name of names.sort()) {
    const child = path.join(relative, name);
    const expected = [
      "archive.json",
      ...archivePaths.map((entry) => `files/${entry}`),
    ];
    if (
      !expected.some(
        (entry) => entry === child || entry.startsWith(`${child}/`),
      )
    )
      throw new Error("Reference archive contains an unexpected entry");
    const metadata = await lstat(path.join(root, child));
    if (metadata.isDirectory()) files.push(...(await inventory(root, child)));
    else {
      await privateEntry(path.join(root, child), false);
      files.push(child);
    }
  }
  return files.sort();
}

async function privateRead(filename: string, maximum: number) {
  const metadata = await privateEntry(filename, false);
  if (metadata.size > maximum)
    throw new Error("Reference archive file exceeds its bound");
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await file.stat();
    if (
      current.dev !== metadata.dev ||
      current.ino !== metadata.ino ||
      current.size !== metadata.size
    )
      throw new Error("Reference archive file changed before read");
    const bounded = Buffer.alloc(metadata.size + 1);
    let count = 0;
    while (count < bounded.length) {
      const result = await file.read(
        bounded,
        count,
        bounded.length - count,
        null,
      );
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    const after = await file.stat();
    if (
      count !== metadata.size ||
      after.mtimeMs !== metadata.mtimeMs ||
      after.size !== metadata.size
    )
      throw new Error("Reference archive file changed during read");
    return bounded.subarray(0, count);
  } finally {
    await file.close();
  }
}

export async function readReferenceArchive(input: ArchiveInput) {
  z.string().startsWith("/").parse(input.directory);
  const selected = await lstat(input.directory);
  if (!selected.isDirectory())
    throw new Error("Reference archive root must be a real directory");
  const root = await realpath(input.directory);
  z.string()
    .regex(/^[a-f0-9]{64}$/u)
    .parse(input.sha256);
  const expected = [
    "archive.json",
    ...archivePaths.map((entry) => `files/${entry}`),
  ].sort();
  if (JSON.stringify(await inventory(root)) !== JSON.stringify(expected))
    throw new Error(
      "Reference archive must contain exactly its manifest and five data files",
    );
  const raw = await privateRead(path.join(root, "archive.json"), 32_768);
  if (digest(raw) !== input.sha256)
    throw new Error("Reference archive manifest hash differs");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new Error("Reference archive manifest JSON is invalid");
  }
  const source = ArchiveSchema.parse(value);
  const files = new Map<string, Buffer>();
  for (const relative of archivePaths) {
    const bytes = await privateRead(
      path.join(root, "files", relative),
      4 * 1024 * 1024,
    );
    const reference = source.reference[relative];
    if (bytes.length !== reference.size || digest(bytes) !== reference.sha256)
      throw new Error("Reference archive data differs from its sealed lineage");
    if (relative === ".obsidian/plugins/tasknotes/data.json")
      assertCredentialFreeSettings(bytes);
    files.set(relative, bytes);
  }
  return { referenceArchive: { archiveSHA256: input.sha256, source }, files };
}

export async function importReferenceArchive(
  input: ArchiveInput,
  target: string,
) {
  const archive = await readReferenceArchive(input);
  await mkdir(target, { recursive: false, mode: 0o700 });
  for (const [relative, bytes] of archive.files) {
    const filename = path.join(target, relative);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await privateEntry(path.dirname(filename), true);
    const file = await open(
      filename,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
  }
  return {
    reference: archive.referenceArchive.source.reference,
    referenceArchive: archive.referenceArchive,
  };
}
