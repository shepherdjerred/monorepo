import { createHash } from "node:crypto";

/** SQL uses encode(sha256(convert_to(canonicalPath,'UTF8')),'hex') exactly. */
export function plexCanonicalPathHash(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath, "utf8").digest("hex");
}
