import { lstat } from "node:fs/promises";
import { FileOperationConflict } from "#filesystem/operations-types.ts";

export async function assertSameMoveIdentity(
  source: string,
  target: string,
): Promise<void> {
  const left = await lstat(source);
  const right = await lstat(target);
  if (left.dev !== right.dev || left.ino !== right.ino)
    throw new FileOperationConflict("Move destination already exists");
}

/** The original lexical ordering is shared by both names of a filesystem move. */
export function orderedMovePaths(source: string, target: string) {
  const paths = [source, target].sort();
  const first = paths[0];
  const second = paths[1];
  if (first === undefined || second === undefined)
    throw new Error("Missing move paths");
  return { first, second };
}
