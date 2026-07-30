import { createHash } from "node:crypto";
import { z } from "zod/v4";

export function glitterContextProposalChecksum(
  files: readonly {
    path: string;
    bytes: Uint8Array | null;
  }[],
): string {
  const hash = createHash("sha256");
  for (const file of files.toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash.update(file.path);
    hash.update("\0");
    if (file.bytes === null) {
      hash.update("deleted");
    } else {
      hash.update(String(file.bytes.length));
      hash.update("\0");
      hash.update(file.bytes);
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function glitterContextRunIdentity(rawRunId: string): {
  runId: string;
  tempDir: string;
  branch: string;
} {
  const runId = z.uuid().parse(rawRunId);
  return {
    runId,
    tempDir: `/tmp/glitter-context-refresh-${runId}`,
    branch: `chore/glitter-context-refresh-${runId}`,
  };
}
