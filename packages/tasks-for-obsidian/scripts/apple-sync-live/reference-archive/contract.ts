import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.uuid();
const fingerprint = z.strictObject({
  size: z
    .number()
    .int()
    .min(0)
    .max(4 * 1024 * 1024),
  sha256: hash,
});
export const archivePaths = [
  ".obsidian/plugins/tasknotes/data.json",
  "Attachments/empty.bin",
  "Attachments/multi-piece.bin",
  "Reference.md",
  "Tasks/Existing.md",
] as const;
const references = z.strictObject({
  ".obsidian/plugins/tasknotes/data.json": fingerprint,
  "Attachments/empty.bin": fingerprint,
  "Attachments/multi-piece.bin": fingerprint,
  "Reference.md": fingerprint,
  "Tasks/Existing.md": fingerprint,
});

export const ArchiveSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("facet-reference-data-archive"),
    sourceRunID: uuid,
    sourceHead: z.string().regex(/^[a-f0-9]{40}$/u),
    remoteVaultID: z.string().regex(/^[a-f0-9]{32}$/u),
    sealSHA256: hash,
    sourceManifestSHA256: hash,
    reference: references,
    credentialAbsence: z.strictObject({
      schemaVersion: z.literal(1),
      sourceRunID: uuid,
      checkedAt: z.iso.datetime(),
      flagsOff: z.literal(true),
      credentialStringsAbsentEmpty: z.literal(true),
      webhookICSCalendarArraysAbsentEmpty: z.literal(true),
      integrationTokenStoresAbsentEmpty: z.literal(true),
      nestedExportsOff: z.literal(true),
      savedSafe: z.literal(true),
      valuesExported: z.literal(false),
    }),
    readerPins: z.strictObject({
      "live-guest.js": hash,
      "live-config.json": hash,
      "artifact.json": hash,
      "payload.json": hash,
    }),
    readerSourcePins: z.strictObject({
      "packages/tasks-for-obsidian/scripts/apple-sync-live/transport/client.ts":
        hash,
      "packages/tasks-for-obsidian/scripts/apple-sync-live/transport/host.ts":
        hash,
      "packages/tasks-for-obsidian/scripts/apple-sync-live/transport/fields.ts":
        hash,
      "packages/tasks-for-obsidian/scripts/apple-sync-live/transport/contract.ts":
        hash,
      "packages/tasks-for-obsidian/scripts/apple-sync-live/transport/execution/bootstrap-code.ts":
        hash,
    }),
    signature: z.strictObject({
      kind: z.literal("adhoc"),
      identifier: z.literal("red.sjer.tasknotes.mac.acceptance"),
      teamIdentifier: z.null(),
      verified: z.literal(true),
      appFileCount: z.number().int().positive(),
      projectSourceSHA256: hash,
      artifactVerifierSourceSHA256: hash,
    }),
    historicalDataOnly: z.literal(true),
    credentialProofReusable: z.literal(false),
    createdAt: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    if (value.sourceRunID !== value.credentialAbsence.sourceRunID)
      context.addIssue({
        code: "custom",
        message: "Archive credential-absence lineage differs",
      });
    if (
      Date.parse(value.credentialAbsence.checkedAt) >
      Date.parse(value.createdAt)
    )
      context.addIssue({
        code: "custom",
        message: "Archive absence check follows export",
      });
  });

export const ArchiveLineageSchema = z.strictObject({
  archiveSHA256: hash,
  source: ArchiveSchema,
});
export type ArchiveLineage = z.infer<typeof ArchiveLineageSchema>;
export type ArchiveInput = { directory: string; sha256: string };

export function assertArchiveBinding(
  lineage: ArchiveLineage | undefined,
  provenanceLineage: unknown,
  remoteVaultID: string,
) {
  const stored = ArchiveLineageSchema.optional().parse(provenanceLineage);
  if (JSON.stringify(lineage) !== JSON.stringify(stored))
    throw new Error("Reference archive lineage differs from fresh provenance");
  if (lineage !== undefined && lineage.source.remoteVaultID !== remoteVaultID)
    throw new Error(
      "Imported reference may bind only its existing synthetic remote vault",
    );
}
