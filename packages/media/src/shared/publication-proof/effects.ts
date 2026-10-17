import { z } from "zod";
import { NativeFileIdentitySchema } from "#shared/native-subtitles.ts";

export const PublicationHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const PublicationPathSchema = z.strictObject({
  root: z.enum(["library", "control"]),
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (path) =>
        !path.startsWith("/") &&
        !path.includes("\\") &&
        !path.includes("\0") &&
        path.split("/").every((part) => !["", ".", ".."].includes(part)),
      "Expected exact root-relative publication path",
    ),
});
export const PhysicalPathStateSchema = z.discriminatedUnion("state", [
  PublicationPathSchema.extend({
    state: z.literal("present"),
    sha256: PublicationHashSchema,
    sizeBytes: z.string().regex(/^\d+$/u),
    identity: NativeFileIdentitySchema,
  }),
  PublicationPathSchema.extend({
    state: z.literal("absent"),
    ancestors: NativeFileIdentitySchema.shape.ancestors,
  }),
]);
export const PublicationJournalSchema = z.strictObject({
  path: z.string().regex(/^journal\/[\w-]{1,100}\.json$/u),
  raw: z.string().min(1).max(32_768),
  sha256: PublicationHashSchema,
  sizeBytes: z.string().regex(/^\d+$/u),
  identity: NativeFileIdentitySchema,
});
export const LockedPrimitiveEffectSchema = z
  .strictObject({
    operationId: z.string().regex(/^[\w-]{1,100}$/u),
    step: z.enum([
      "import_backup_link",
      "import_publish_rename",
      "import_publish_link",
      "import_stage_unlink",
      "import_duplicate_stage_unlink",
      "move_link",
      "move_unlink",
      "rollback_rejected_link",
      "rollback_stage_link",
      "rollback_publish_rename",
      "recovery_redundant_unlink",
    ]),
    primitive: z.enum(["link", "rename", "unlink"]),
    source: PublicationPathSchema,
    target: PublicationPathSchema.nullable(),
    before: z.array(PhysicalPathStateSchema).min(1),
    after: z.array(PhysicalPathStateSchema).min(1),
    journal: PublicationJournalSchema,
  })
  .refine(
    (effect) => (effect.primitive === "unlink") === (effect.target === null),
    "Only unlink omits a target",
  );
/** Actual atomic replacement of the control journal, separate from media syscalls. */
export const LockedJournalCompletionSchema = z.strictObject({
  operationId: z.string().regex(/^[\w-]{1,100}$/u),
  step: z.literal("journal_complete"),
  primitive: z.literal("journal_complete"),
  beforeJournal: PublicationJournalSchema,
  journal: PublicationJournalSchema,
  participants: z.array(PhysicalPathStateSchema).min(1),
});
export const LockedPublicationEventSchema = z.union([
  LockedPrimitiveEffectSchema,
  LockedJournalCompletionSchema,
]);
export const PublicationEffectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  transitionId: z.uuid(),
  continuationId: z.uuid().nullable(),
  intentHash: PublicationHashSchema,
  ordinal: z.int().nonnegative(),
  previousEffectHash: PublicationHashSchema.nullable(),
  entryOperationId: z.string().regex(/^[\w-]{1,100}$/u),
  assetId: z.uuid(),
  subtitleId: z.uuid().nullable(),
  libraryKind: z.enum(["movies", "tv"]),
  effect: LockedPublicationEventSchema,
});
export const PublicationEffectRefSchema = z.strictObject({
  ordinal: z.int().nonnegative(),
  libraryKind: z.enum(["movies", "tv"]),
  effectHash: PublicationHashSchema,
  operationId: z.string().regex(/^[\w-]{1,100}$/u),
  step: z.union([
    LockedPrimitiveEffectSchema.shape.step,
    z.literal("journal_complete"),
  ]),
});
export type PublicationPath = z.infer<typeof PublicationPathSchema>;
export type PhysicalPathState = z.infer<typeof PhysicalPathStateSchema>;
export type PublicationJournal = z.infer<typeof PublicationJournalSchema>;
export type LockedPrimitiveEffect = z.infer<typeof LockedPrimitiveEffectSchema>;
export type LockedJournalCompletion = z.infer<
  typeof LockedJournalCompletionSchema
>;
export type LockedPublicationEvent = z.infer<
  typeof LockedPublicationEventSchema
>;
export type PublicationEffect = z.infer<typeof PublicationEffectSchema>;
export type PublicationEffectRef = z.infer<typeof PublicationEffectRefSchema>;
