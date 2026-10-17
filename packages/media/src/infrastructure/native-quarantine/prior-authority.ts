import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeQuarantineContinuationSchema,
  NativeQuarantineScopeSchema,
  NativeQuarantineBindingSchema,
  type NativeQuarantineFile,
  type NativeQuarantineScope,
} from "#shared/native-recovery/quarantine.ts";
import { FinishedNativeV2Schema } from "#shared/native-recovery/lifecycle.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { assertQuarantinedSubtitleBindings } from "#automation/native-quarantine/subtitles.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const SelectionSchema = z.object({
  scope: NativeQuarantineScopeSchema,
  bindings: z.array(NativeQuarantineBindingSchema),
});
const digest = (value: unknown) => snapshotHash(z.json().parse(value));

/** Original manifests remain immutable; a later binding needs its exact committed receipt. */
export async function assertQuarantineGroupAuthority(
  tx: Prisma.TransactionClient,
  group: NativeQuarantineScope["groups"][number],
  files: NativeQuarantineFile[],
) {
  for (const file of files) assertQuarantinedSubtitleBindings(file);
  const first = group.decisions[0];
  if (first === undefined) throw new Error("Quarantine decision missing");
  const manifest = RemovalPlanSchema.parse(first.manifest);
  if (
    files.every(
      (file) =>
        first.recoveryEpoch === file.ownershipEpoch &&
        manifest.assets.some(
          (entry) =>
            entry.assetId === file.assetId &&
            entry.assetVersion + 1 === file.assetVersion,
        ),
    )
  )
    return;
  const rows = await tx.nativeQuarantineContinuation.findMany({
    where: {
      descriptor: {
        path: ["group", "decisions"],
        array_contains: [{ id: first.id }],
      },
    },
    include: { receipt: { include: { plan: true } } },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (rows.length > 100)
    throw new Error("Quarantine prior authority lookup exceeds bound");
  const matches = rows.filter((row) => {
    if (
      row.state !== "pending" ||
      row.executionEvidence !== null ||
      row.restoration !== null ||
      row.receipt.plan.state !== "applied" ||
      row.receipt.plan.planHash !== row.receipt.planHash ||
      row.receipt.recoveryEpoch !== row.recoveryEpoch
    )
      return false;
    const descriptor = NativeQuarantineContinuationSchema.parse(row.descriptor);
    const selection = SelectionSchema.parse(row.receipt.selection);
    const finished = FinishedNativeV2Schema.parse(row.receipt.plan.plan);
    if (
      finished.lifecycleKind !== "committed_quarantine" ||
      digest(finished) !== row.receipt.planHash ||
      finished.scopeHash !== digest(selection.scope) ||
      digest(selection.scope) !== digest(row.receipt.plan.scope) ||
      !selection.scope.groups.some(
        (item) => digest(item) === digest(descriptor.group),
      ) ||
      stableGroup(descriptor.group) !== stableGroup(group) ||
      descriptor.group.decisions.some(
        (original) =>
          !group.decisions.some(
            (current) =>
              current.id === original.id && current.version >= original.version,
          ),
      )
    )
      return false;
    const selectedFiles = selection.scope.files.filter((file) =>
      group.assetIds.includes(file.assetId),
    );
    const selectedBindings = selection.bindings.filter((binding) =>
      group.assetIds.includes(binding.assetId),
    );
    return (
      digest(descriptor.files) === digest(selectedFiles) &&
      digest(descriptor.bindings) === digest(selectedBindings) &&
      descriptor.files.length === files.length &&
      descriptor.bindings.length === files.length &&
      files.every((file) =>
        exactRebinding(
          { ...file, groupHash: descriptor.group.groupHash },
          descriptor,
          row.recoveryEpoch,
        ),
      )
    );
  });
  if (matches.length !== 1)
    throw new Error(
      "Quarantine current binding lacks an exact pending native receipt",
    );
}

function stableGroup(group: NativeQuarantineScope["groups"][number]) {
  const { groupHash: _hash, decisions, ...identity } = group;
  return digest({
    ...identity,
    decisions: decisions.map(({ version: _version, ...decision }) => decision),
  });
}

function exactRebinding(
  file: NativeQuarantineFile,
  descriptor: z.infer<typeof NativeQuarantineContinuationSchema>,
  epoch: number,
) {
  const previous = descriptor.files.find(
    (item) => item.assetId === file.assetId,
  );
  const binding = descriptor.bindings.find(
    (item) => item.assetId === file.assetId,
  );
  if (previous === undefined || binding === undefined) return false;
  const expectedSubtitles = previous.subtitles.map((subtitle) => ({
    ...subtitle,
    ownershipEpoch: epoch,
    version: subtitle.version + 1,
    videoVersion: previous.assetVersion + 1,
  }));
  const expectedBinding = {
    assetId: previous.assetId,
    beforeVersion: previous.assetVersion,
    assetVersion: previous.assetVersion + 1,
    checksum: previous.checksum,
    mediaIds: previous.mediaIds,
    ownershipEpoch: epoch,
    subtitles: expectedSubtitles.map((subtitle) => ({
      id: subtitle.id,
      version: subtitle.version,
      videoVersion: subtitle.videoVersion,
      checksum: subtitle.checksum,
      storageKind: subtitle.storageKind,
    })),
  };
  return (
    digest(binding) === digest(expectedBinding) &&
    digest(file) ===
      digest({
        ...previous,
        assetVersion: binding.assetVersion,
        ownershipEpoch: epoch,
        subtitles: expectedSubtitles,
      })
  );
}
