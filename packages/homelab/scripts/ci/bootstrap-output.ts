import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export function assertExternalBootstrapPath(
  repository: string,
  directory: string,
) {
  const relative = path.relative(
    path.resolve(repository),
    path.resolve(directory),
  );
  if (!(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ))
    throw new Error("Bootstrap state must stay outside the Git worktree");
}

/** Resolve existing parent symlinks before creating any deployment receipt. */
export async function createBootstrapDirectory(
  repository: string,
  directory: string,
) {
  assertExternalBootstrapPath(repository, directory);
  const parent = await realpath(path.dirname(directory));
  assertExternalBootstrapPath(
    await realpath(repository),
    path.join(parent, path.basename(directory)),
  );
  await mkdir(directory, { mode: 0o700 });
  const metadata = await stat(directory);
  if (metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o700)
    throw new Error(
      "Bootstrap output must be an operator-owned private directory",
    );
}
