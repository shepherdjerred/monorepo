import { createHash } from "node:crypto";
import { z } from "zod";
import type { NativeArchiveExecutionSchema } from "#shared/native-recovery/archive.ts";
import type { FileOperationManifest } from "#filesystem/operations-types.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import type { ArchiveFileContext } from "./execution.ts";

export function archivePurgeId(continuationId: string, canonicalPath: string) {
  return `native-archive-${z.uuid().parse(continuationId)}-${createHash("sha256").update(canonicalPath).digest("hex").slice(0, 20)}`;
}

export function archivePurgeManifest(
  context: ArchiveFileContext,
  continuationId: string,
  item: z.infer<typeof NativeArchiveExecutionSchema>["participants"][number],
): FileOperationManifest {
  const source = nativeLocalPath(context, item.canonicalPath);
  return {
    version: 1,
    operationId: archivePurgeId(continuationId, item.canonicalPath),
    kind: "purge",
    source,
    target: source,
    sha256: item.checksum,
    previousSha256: null,
    phase: "prepared",
  };
}
