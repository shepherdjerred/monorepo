import { Buffer } from "node:buffer";
import { constants, copyFile, open } from "node:fs/promises";
import path from "node:path";
import { Digest } from "#learning/preference/gate.ts";
import { readJson } from "#learning/preference/ledger.ts";

/** Stream large recordings and binaries; evidence size never becomes a single allocation. */
export async function hashFile(file: string) {
  const handle = await open(file, "r");
  const digest = new Bun.CryptoHasher("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return digest.digest("hex");
}

export async function copyEvidence(
  source: string,
  target: string,
  expected: string,
) {
  Digest.parse(expected);
  await copyFile(source, target, constants.COPYFILE_EXCL);
  if ((await hashFile(target)) !== Digest.parse(expected))
    throw new Error(`copied promotion evidence differs: ${target}`);
  const file = await open(target, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export class Snapshot {
  private readonly bindings = new Map<string, string>();

  async add(file: string, expected?: string) {
    const resolved = path.resolve(file);
    const digest = await hashFile(resolved);
    const required = expected ?? this.bindings.get(resolved);
    if (required !== undefined && digest !== Digest.parse(required))
      throw new Error(`promotion evidence changed: ${resolved}`);
    const previous = this.bindings.get(resolved);
    if (previous !== undefined && previous !== digest)
      throw new Error(
        `promotion evidence changed after its first snapshot: ${resolved}`,
      );
    this.bindings.set(resolved, digest);
    return digest;
  }

  async json(file: string) {
    await this.add(file);
    return readJson(file);
  }

  async include(files: readonly { file: string; sha256: string }[]) {
    for (const file of files) await this.add(file.file, file.sha256);
  }

  files() {
    return Array.from(this.bindings, ([file, sha256]) => ({
      file,
      sha256,
    })).sort((left, right) => left.file.localeCompare(right.file));
  }

  async verify() {
    for (const file of this.files()) await this.add(file.file, file.sha256);
  }

  async archive(directory: string) {
    const catalogue = new Map<string, { file: string; sha256: string }>();
    for (const input of this.files()) {
      await this.add(input.file, input.sha256);
      if (catalogue.has(input.sha256)) continue;
      const relative = `evidence/${input.sha256}.blob`;
      const target = path.join(directory, relative);
      await copyEvidence(input.file, target, input.sha256);
      catalogue.set(input.sha256, { file: relative, sha256: input.sha256 });
    }
    await this.verify();
    return [...catalogue.values()].sort((left, right) =>
      left.sha256.localeCompare(right.sha256),
    );
  }
}
