import {
  buildArtifactPath,
  type ArtifactWorkspace,
} from "#build/storage/artifact-path.ts";
import { lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { BUILD_FILES, type BuildLogEntry } from "#protocol/build.ts";

const Identity = z.strictObject({
  id: z.uuid(),
  files: z.record(
    z
      .string()
      .regex(
        /^(?:expected\.json|expected\.schem|expected-parts\/(?:parts\.json|\d+\.schem))$/u,
      ),
    z.string().regex(/^[a-f0-9]{64}$/u),
  ),
});

async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

async function filesOf(workspace: ArtifactWorkspace): Promise<string[]> {
  const files: string[] = [BUILD_FILES.expected];
  if (await present(workspace.file(BUILD_FILES.expectedSchematic)))
    files.push(BUILD_FILES.expectedSchematic);
  if (await present(workspace.file(BUILD_FILES.expectedParts))) {
    const entries = await readdir(
      await buildArtifactPath(workspace, BUILD_FILES.expectedParts),
      { withFileTypes: true },
    );
    for (const entry of entries) {
      if (!entry.isFile()) throw new Error("unexpected frozen run artifact");
      files.push(path.join(BUILD_FILES.expectedParts, entry.name));
    }
  }
  return files.toSorted();
}

async function hashFile(workspace: ArtifactWorkspace, file: string) {
  return createHash("sha256")
    .update(await Bun.file(await buildArtifactPath(workspace, file)).bytes())
    .digest("hex");
}

/** Install this identity before replacing any frozen bytes; journal it only after all files install. */
export async function writeRunIdentity(
  workspace: ArtifactWorkspace,
  id: string,
): Promise<void> {
  const files: Record<string, string> = {};
  for (const file of await filesOf(workspace))
    files[file] = await hashFile(workspace, file);
  await Bun.write(
    workspace.file(BUILD_FILES.expectedRun),
    `${JSON.stringify(Identity.parse({ id, files }))}\n`,
  );
}

/** Every expected read rejects mixed artifact/journal generations after a process exit. */
export async function validateRunIdentity(
  workspace: ArtifactWorkspace,
  run: Extract<BuildLogEntry, { kind: "run" }> | null,
): Promise<void> {
  const marker = workspace.file(BUILD_FILES.expectedRun);
  if (!(await present(marker))) {
    if (run?.id !== undefined) throw new Error("missing frozen run identity");
    return;
  }
  const identity = Identity.parse(
    await Bun.file(
      await buildArtifactPath(workspace, BUILD_FILES.expectedRun),
    ).json(),
  );
  if (run?.id !== identity.id)
    throw new Error(
      "frozen run identity does not match the journal; rerun the build",
    );
  const files = await filesOf(workspace);
  if (
    JSON.stringify(files) !==
    JSON.stringify(Object.keys(identity.files).toSorted())
  )
    throw new Error("frozen run artifact set does not match its identity");
  for (const [file, hash] of Object.entries(identity.files)) {
    if ((await hashFile(workspace, file)) !== hash)
      throw new Error(`frozen run artifact hash does not match: ${file}`);
  }
}
