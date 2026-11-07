import { DefaultAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { fileIdentityEvidence, type IdentityTorrentFile } from "./evidence.ts";

/** Preserve the exact optional historical evidence branch and strict new parser. */
export function inspectionIdentity(raw: unknown, file: IdentityTorrentFile) {
  const identity =
    raw === null ? null : DefaultAcquisitionIdentitySchema.parse(raw);
  const evidence =
    identity === null ? undefined : fileIdentityEvidence(identity, file);
  return { identity, evidence };
}
