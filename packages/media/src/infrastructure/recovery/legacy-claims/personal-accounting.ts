import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { RecoveryClaimProjection } from "#shared/recovery-claims.ts";
import {
  PersonalMigrationClaimSchema,
  ImportedPersonalClaimSchema,
} from "#shared/personal-migration/contract.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { MigrationRecordSchema, SourceKindSchema } from "#shared/migration.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { personalNativeAccounted } from "./personal-native.ts";
import { recordKey } from "#migration/capture/capture-validation.ts";

type Stored = Prisma.MigrationRecordGetPayload<{ include: { capture: true } }>;
const Receipt = z.object({
  schemaVersion: z.literal(1),
  captures: z
    .array(
      z.object({
        id: z.uuid(),
        captureHash: z.string(),
        sourceKind: z.string(),
      }),
    )
    .max(20),
  claims: z.array(PersonalMigrationClaimSchema).max(1000),
  sourceRecords: z
    .array(
      z.strictObject({
        captureId: z.uuid(),
        provenanceKey: z.string(),
        observationHash: z.string(),
      }),
    )
    .max(1000),
  imports: z.array(ImportedPersonalClaimSchema).max(50_000),
  keepingPolicy: z.literal("temporary"),
  interestState: z.literal("following"),
  changesPlaybackState: z.literal(false),
  transfersTorrentOwnership: z.literal(false),
});
export function personalSourceSelection(
  raw: unknown,
  stored: Pick<
    Stored,
    "captureId" | "provenanceKey" | "observationHash" | "payload"
  > & {
    capture: Pick<
      Stored["capture"],
      "manifestHash" | "sourceKind" | "sourceInstanceId"
    >;
  },
) {
  const receipt = Receipt.parse(raw);
  if (
    !receipt.captures.some(
      (capture) =>
        capture.id === stored.captureId &&
        capture.captureHash === stored.capture.manifestHash &&
        capture.sourceKind === stored.capture.sourceKind,
    )
  )
    return null;
  const source = receipt.sourceRecords.find(
    (row) =>
      row.captureId === stored.captureId &&
      row.provenanceKey === stored.provenanceKey,
  );
  const record = MigrationRecordSchema.parse(stored.payload);
  if (
    source?.observationHash !== stored.observationHash ||
    snapshotHash(nativeJson(record)) !== stored.observationHash ||
    record.kind !== "request" ||
    recordKey(
      {
        sourceKind: SourceKindSchema.parse(stored.capture.sourceKind),
        sourceInstanceId: stored.capture.sourceInstanceId,
      },
      record,
    ) !== stored.provenanceKey
  )
    return null;
  const selected = receipt.claims.find(
    (claim) =>
      claim.captureId === stored.captureId &&
      claim.provenanceKey === stored.provenanceKey,
  );
  if (
    selected?.sourceId !== record.sourceId ||
    selected.requesterSourceId !== record.requesterSourceId ||
    selected.sourceStatus !== (record.sourceStatus ?? null)
  )
    return null;
  return {
    selected,
    record,
    refs: receipt.imports.filter(
      (ref) =>
        ref.captureId === stored.captureId &&
        ref.provenanceKey === stored.provenanceKey,
    ),
  };
}
/** Only literal immutable source receipts replace their own legacy claims.
 * Native policy/status may subsequently change; identity cannot. */
export async function personalSourceAccounting(
  tx: Prisma.TransactionClient,
  stored: Stored,
  options: {
    edition?: string;
    claim?: RecoveryClaimProjection;
    budget?: PublicationAuthorityReadBudget | undefined;
  } = {},
) {
  if (!stored.capture.complete || !stored.capture.stable) return false;
  const events = await tx.applicationEvent.findMany({
    where: {
      kind: "personal_state_imported",
      payload: {
        path: ["sourceRecords"],
        array_contains: [
          {
            captureId: stored.captureId,
            provenanceKey: stored.provenanceKey,
            observationHash: stored.observationHash,
          },
        ],
      },
    },
    orderBy: { id: "asc" },
    take: options.budget?.take ?? 1001,
  });
  options.budget?.consume(events.length);
  if (events.length > 1000)
    throw new Error(
      "Personal claim accounting exceeds bounded receipt history",
    );
  for (const event of events) {
    const selection = personalSourceSelection(event.payload, stored);
    if (selection === null) continue;
    // Explicit owner historical disposition is never invented requester consent.
    if (
      selection.selected.disposition === "history" &&
      selection.selected.reason === "owner_reviewed_history_only"
    )
      return true;
    if (await personalNativeAccounted(tx, { ...selection, ...options }))
      return true;
  }
  return false;
}
export async function unreviewedPersonalRecords(
  tx: Prisma.TransactionClient,
  records: Stored[],
  budget?: PublicationAuthorityReadBudget,
) {
  const remaining: Stored[] = [];
  for (const stored of records)
    if (!(await personalSourceAccounting(tx, stored, { budget })))
      remaining.push(stored);
  return remaining;
}
export async function unaccountedPersonalClaim(
  tx: Prisma.TransactionClient,
  stored: Stored,
  claim: RecoveryClaimProjection,
  budget?: PublicationAuthorityReadBudget,
) {
  return (await personalSourceAccounting(tx, stored, { claim, budget }))
    ? { ...claim, mediaIds: [] }
    : claim;
}
