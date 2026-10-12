import { realpath } from "node:fs/promises";
import path from "node:path";

export type ArtifactWorkspace = {
  dir: string;
  file: (relative: string) => string;
};

/** Resolve evidence only within its build, including through symlinks. */
export async function buildArtifactPath(
  workspace: ArtifactWorkspace,
  file: string,
): Promise<string> {
  const root = await realpath(workspace.dir);
  const absolute = await realpath(workspace.file(file));
  const relative = path.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`build artifact is outside its build: ${file}`);
  return absolute;
}
