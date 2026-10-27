import { z } from "zod";
import {
  MovieSubtitleInstallV4Schema,
  MovieSubtitleOperationV4Schema,
} from "./subtitles-v4.ts";
import { MovieEditionHashSchema } from "./registry.ts";
import { MoviePublicationReferenceV2Schema } from "./publication-v2.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import { PublicationSubtitleHistorySchema } from "#shared/publication-proof/intent.ts";

/** Paths stay in persisted Activity evidence, outside Workflow inputs and results. */
export const MovieSubtitleReceiptV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  input: MovieSubtitleInstallV4Schema,
  target: MovieSubtitleOperationV4Schema,
  command: z.strictObject({
    kind: z.literal("acquire_movie_subtitles_v4"),
    targetId: z.uuid(),
    payloadHash: MovieEditionHashSchema,
  }),
  publication: MoviePublicationReferenceV2Schema,
  videoPath: z.string().min(1),
  before: PublicationSubtitleHistorySchema,
  after: NativeSubtitleSnapshotSchema,
  journal: z.strictObject({
    version: z.literal(1),
    operationId: z.uuid(),
    kind: z.literal("import"),
    source: z.string().min(1),
    target: z.string().min(1),
    sha256: MovieEditionHashSchema,
    previousSha256: z.null(),
    phase: z.literal("complete"),
  }),
  committedAt: z.iso.datetime(),
  observedAt: z.iso.datetime(),
  sdkExpiresAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type MovieSubtitleReceiptV4 = z.infer<
  typeof MovieSubtitleReceiptV4Schema
>;
