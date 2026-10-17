import { z } from "zod";
import { HandoffFileEvidenceSchema } from "#shared/handoff.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Path = z.string().min(1).max(4096);
const Kind = z.enum(["purged", "rollback_cancelled"]);
const Identity = HandoffFileEvidenceSchema.shape.files.element.shape.identity;
export const NativeTerminalDependencySchema = z.strictObject({
  cleanupId: z.uuid(),
  kind: Kind,
  birthEpoch: z.int().nonnegative(),
  assetIds: z.array(z.uuid()).length(2),
  rowDigest: Hash,
  files: z
    .array(
      z.strictObject({
        canonicalPath: Path,
        expectedChecksum: Hash.nullable(),
      }),
    )
    .min(1)
    .max(202),
  journals: z
    .array(
      z.strictObject({
        operationId: z.string().regex(/^[\w-]{1,100}$/u),
        kind: z.enum(["import", "rollback", "restore", "purge"]),
        source: Path,
        target: Path,
        sha256: Hash,
        previousSha256: Hash.nullable(),
      }),
    )
    .min(1)
    .max(202),
});
export const NativeTerminalEvidenceSchema = z.strictObject({
  cleanupId: z.uuid(),
  kind: Kind,
  journalDigest: Hash,
  files: z
    .array(
      z.union([
        z.strictObject({
          canonicalPath: Path,
          sha256: z.null(),
          identity: z.null(),
          absentAncestors: Identity.shape.ancestors,
        }),
        z.strictObject({
          canonicalPath: Path,
          sha256: Hash,
          identity: Identity,
          absentAncestors: z.array(Identity.shape.ancestors.element).length(0),
        }),
      ]),
    )
    .min(1)
    .max(202),
});
export type NativeTerminalDescriptor = z.infer<
  typeof NativeTerminalDependencySchema
>;
export type NativeTerminalEvidence = z.infer<
  typeof NativeTerminalEvidenceSchema
>;
