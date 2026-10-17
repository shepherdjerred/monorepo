import { z } from "zod";

export const OwnerHealthReasonSchema = z.enum([
  "legacy_writer_authority_revoked",
  "media_storage_authority_revoked",
]);
export const AuthorityRevocationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recoveryEpoch: z.number().int().nonnegative(),
  runtimeVersion: z.number().int().nonnegative(),
  reason: OwnerHealthReasonSchema,
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const OwnerHealthSchema = AuthorityRevocationSchema.extend({
  sourceEventId: z.uuid(),
});
export const VerificationAuthoritySchema = z.strictObject({
  schemaVersion: z.literal(1),
  verificationId: z.uuid(),
  requesterId: z.string(),
  recoveryEpoch: z.number().int().nonnegative(),
});
export const ownerHealthDescriptions: Record<
  z.infer<typeof OwnerHealthReasonSchema>,
  string
> = {
  legacy_writer_authority_revoked:
    "A legacy media manager resumed or its writer authority could not be confirmed. Media automation has paused in observe mode.",
  media_storage_authority_revoked:
    "The approved media storage binding changed or could not be confirmed. Media automation has paused in observe mode.",
};
export function ownerHealthKey(
  value: z.infer<typeof AuthorityRevocationSchema>,
): string {
  return `owner-health:${String(value.recoveryEpoch)}:${String(value.runtimeVersion)}:${value.reason}`;
}
