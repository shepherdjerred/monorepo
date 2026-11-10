import { constants, open, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";

/** The SDK creates its schema before our launcher drops the provider's uid. */
export async function prepareCodexOutputSchema(
  args: readonly string[],
  providerUid: number,
  sdkTemporaryDirectory: string,
): Promise<void> {
  const positions = args.flatMap((arg, index) =>
    arg === "--output-schema" ? [index] : [],
  );
  const position = positions[0];
  if (position === undefined) return;
  const schemaPath = args[position + 1];
  if (schemaPath === undefined || positions.length !== 1)
    throw new Error("Expected one SDK output schema path");
  const directory = path.dirname(schemaPath);
  if (
    !path.isAbsolute(schemaPath) ||
    path.resolve(schemaPath) !== schemaPath ||
    path.basename(schemaPath) !== "schema.json" ||
    path.dirname(directory) !== path.resolve(sdkTemporaryDirectory) ||
    !/^codex-output-schema-[a-zA-Z0-9]+$/.test(path.basename(directory))
  )
    throw new Error("Output schema must belong to the SDK temporary directory");
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Codex uid isolation requires Unix");
  const dir = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await dir.stat();
    if (stat.uid !== uid || (stat.mode & 0o077) !== 0)
      throw new Error("SDK output schema directory must be privately owned");
    const entries = await readdir(directory);
    if (entries.length !== 1 || entries[0] !== "schema.json")
      throw new Error("SDK output schema directory has unexpected contents");
    const schema = await open(
      schemaPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const file = await schema.stat();
      if (!file.isFile() || file.uid !== uid || file.nlink !== 1)
        throw new Error("SDK output schema must be an owned regular file");
      // Transfer the file before its directory: the provider cannot replace it
      // between validation and chown. File descriptors also reject symlink swaps.
      await schema.chown(providerUid, providerUid);
      await dir.chown(providerUid, providerUid);
    } finally {
      await schema.close();
    }
  } finally {
    await dir.close();
  }
}

if (import.meta.main) {
  const uid = z.coerce.number().int().positive().parse(Bun.argv[2]);
  const temporaryDirectory = z.string().min(1).parse(Bun.argv[3]);
  await prepareCodexOutputSchema(Bun.argv.slice(4), uid, temporaryDirectory);
}
