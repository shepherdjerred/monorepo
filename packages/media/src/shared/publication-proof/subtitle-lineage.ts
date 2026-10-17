import { z } from "zod";
import {
  NativeTerminalDependencySchema,
  NativeTerminalEvidenceSchema,
} from "#shared/native-recovery/terminal.ts";
import { PublicationHashSchema, PublicationJournalSchema } from "./effects.ts";

/** Later caption authority is separate from the immutable video compensation grant. */
export const PublicationSubtitleLineageSchema = z.strictObject({
  baselineHash: PublicationHashSchema,
  currentHash: PublicationHashSchema,
  historyHash: PublicationHashSchema,
  replacements: z
    .array(z.strictObject({ beforeId: z.uuid(), afterId: z.uuid() }))
    .max(100),
  artifactIdentities: z
    .array(
      z.strictObject({
        canonicalPath: z.string().min(1).max(4096),
        identity: z.strictObject({
          device: z.string().regex(/^\d+$/u),
          inode: z.string().regex(/^\d+$/u),
          mtimeNs: z.string().regex(/^-?\d+$/u),
          sizeBytes: z.string().regex(/^\d+$/u),
          checksum: PublicationHashSchema,
        }),
      }),
    )
    .max(202),
  files: z.array(NativeTerminalDependencySchema.shape.files.element).max(202),
  journals: z
    .array(NativeTerminalDependencySchema.shape.journals.element)
    .max(202),
  installations: z
    .array(
      z.strictObject({
        subtitleId: z.uuid(),
        journals: z
          .array(NativeTerminalDependencySchema.shape.journals.element)
          .min(1)
          .max(100),
      }),
    )
    .max(100),
});
export type PublicationSubtitleLineage = z.infer<
  typeof PublicationSubtitleLineageSchema
>;

export const PublicationSubtitleEvidenceSchema = z.strictObject({
  lineageHash: PublicationHashSchema,
  files: z.array(NativeTerminalEvidenceSchema.shape.files.element).max(202),
  journals: z.array(PublicationJournalSchema).max(302),
});
export type PublicationSubtitleEvidence = z.infer<
  typeof PublicationSubtitleEvidenceSchema
>;
