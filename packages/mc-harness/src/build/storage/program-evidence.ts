import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { BUILD_FILES } from "#protocol/build.ts";
import { buildArtifactPath, type ArtifactWorkspace } from "./artifact-path.ts";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const EvidenceSchema = z.strictObject({
  version: z.literal(1),
  programHash: HashSchema,
  outputs: z.record(z.string(), HashSchema),
});
const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** The entry text and output of one compile retain their original checksums. */
export function programSnapshot(digest: string): string {
  if (!/^[a-f0-9]+$/u.test(digest))
    throw new Error("program snapshot digest must be lowercase hexadecimal");
  return path.join(BUILD_FILES.schematicsDir, `program-${digest}.build.ts`);
}

function evidencePaths(file: string) {
  const match = /^program-([a-f0-9]+)\.build\.ts$/u.exec(path.basename(file));
  if (
    path.dirname(file) !== BUILD_FILES.schematicsDir ||
    match?.[1] === undefined
  )
    throw new Error(`invalid producing program snapshot path: ${file}`);
  const stem = path.join(BUILD_FILES.schematicsDir, `program-${match[1]}`);
  return { record: `${stem}.json`, whole: `${stem}.schem` };
}

export async function recordProgramEvidence(
  workspace: ArtifactWorkspace,
  digest: string,
  outputs: readonly string[],
): Promise<void> {
  const snapshot = programSnapshot(digest);
  const paths = evidencePaths(snapshot);
  const hashes: Record<string, string> = {};
  for (const file of new Set([paths.whole, ...outputs])) {
    hashes[file] = checksum(
      await Bun.file(await buildArtifactPath(workspace, file)).bytes(),
    );
  }
  await Bun.write(
    workspace.file(paths.record),
    JSON.stringify({
      version: 1,
      programHash: checksum(
        await Bun.file(await buildArtifactPath(workspace, snapshot)).bytes(),
      ),
      outputs: hashes,
    }),
  );
}

/** Return only the verified bytes that callers will copy or review. */
export async function readProgramSnapshot(
  workspace: ArtifactWorkspace,
  file: string,
): Promise<Uint8Array> {
  const paths = evidencePaths(file);
  const record = EvidenceSchema.parse(
    await Bun.file(await buildArtifactPath(workspace, paths.record)).json(),
  );
  const bytes = await Bun.file(
    await buildArtifactPath(workspace, file),
  ).bytes();
  if (checksum(bytes) !== record.programHash)
    throw new Error(
      `producing program snapshot checksum does not match: ${file}`,
    );
  if (record.outputs[paths.whole] === undefined)
    throw new Error("producing program evidence omits its compile output");
  for (const [output, hash] of Object.entries(record.outputs)) {
    if (
      path.dirname(output) !== BUILD_FILES.schematicsDir ||
      !output.endsWith(".schem")
    )
      throw new Error(`invalid producing program output path: ${output}`);
    if (
      checksum(
        await Bun.file(await buildArtifactPath(workspace, output)).bytes(),
      ) !== hash
    )
      throw new Error(
        `producing program output checksum does not match: ${output}`,
      );
  }
  return bytes;
}
