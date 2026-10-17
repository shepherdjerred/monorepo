import { z } from "zod";
import {
  PublicationHashSchema as Hash,
  PublicationEffectRefSchema,
  PublicationJournalSchema,
} from "./effects.ts";
import {
  PublicationAssetSnapshotSchema,
  PublicationParticipantSchema,
} from "./intent.ts";

export const PublicationOutcomeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(["published", "compensated"]),
  transitionId: z.uuid(),
  intentHash: Hash,
  filePlanHash: Hash,
  birthEpoch: z.int().nonnegative(),
  effects: z.array(PublicationEffectRefSchema),
  entries: z
    .array(
      z.strictObject({
        entryOperationId: z.string().regex(/^[\w-]{1,100}$/u),
        predecessor: PublicationAssetSnapshotSchema.nullable(),
        successor: PublicationAssetSnapshotSchema.nullable(),
        participants: z.array(PublicationParticipantSchema).min(1),
        journals: z.array(PublicationJournalSchema),
      }),
    )
    .min(1)
    .max(100),
  completedAt: z.iso.datetime(),
});
export type PublicationOutcome = z.infer<typeof PublicationOutcomeSchema>;
