import { lstat } from "node:fs/promises";
import {
  FileOperationConflict,
  IdSchema,
  DigestSchema,
} from "#filesystem/operations-types.ts";

export type RollbackFile = {
  operationId: string;
  rollbackOperationId: string;
  libraryPath: string;
  sha256: string;
  previousSha256: string;
};

export type ScopedMoveFile = {
  operationId: string;
  kind: "quarantine" | "restore";
  source: string;
  target: string;
  sha256: string;
};

export function validateRollbackFile(input: RollbackFile) {
  IdSchema.parse(input.operationId);
  IdSchema.parse(input.rollbackOperationId);
  DigestSchema.parse(input.sha256);
  DigestSchema.parse(input.previousSha256);
  if (
    input.operationId === input.rollbackOperationId ||
    input.sha256 === input.previousSha256
  )
    throw new FileOperationConflict(
      "Rollback must identify a distinct version and operation",
    );
}

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
