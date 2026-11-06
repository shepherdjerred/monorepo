import { createHash } from "node:crypto";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** SQL verifies these existing application canonical bytes rather than
 * introducing a second JSON serializer at a durable boundary. */
export function assertMovieRollbackCanonical(
  raw: string,
  value: unknown,
  hash: string,
) {
  if (
    createHash("sha256").update(raw).digest("hex") !== hash ||
    identityHash(JSON.parse(raw)) !== hash ||
    identityHash(value) !== hash
  )
    throw new Error(
      "Movie rollback canonical bytes changed their literal record",
    );
}
