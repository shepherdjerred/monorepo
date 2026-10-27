import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  NativeQuarantineContinuationSchema,
  NativeQuarantineRestorationSchema,
  NativeQuarantineScopeSchema,
  NativeQuarantineBindingSchema,
} from "#shared/native-recovery/quarantine.ts";
import {
  FinishedNativeV2Schema,
  SettledNativeQuarantineSchema,
} from "#shared/native-recovery/lifecycle.ts";
import type { NativeRecoveryScopeSchema } from "#shared/native-recovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { terminalRebindingChain } from "#infrastructure/native-recovery/terminal-rebinding.ts";
import { terminalSubtitleChain } from "#infrastructure/native-recovery/terminal-subtitles.ts";
import { FinishedQuarantinePlexV3Schema } from "#shared/plex-binding/native-version.ts";
import { validateNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { settledInstalledSubtitle } from "./installed-subtitles.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

const digest = (value: unknown) => snapshotHash(z.json().parse(value));
type File = z.infer<typeof NativeRecoveryScopeSchema>["files"][number];

/** A completed native restore settles its own historical decisions, never unrelated quarantine. */
export async function settledNativeQuarantines(
  tx: Prisma.TransactionClient,
  files: File[],
  budget = new PublicationAuthorityReadBudget(),
) {
  const mediaIds = files.flatMap((file) => file.mediaIds);
  const decisions = await tx.retentionDecision.findMany({
    where: {
      edition: "default",
      mediaId: { in: mediaIds },
      state: "quarantined",
      manifest: { not: Prisma.DbNull },
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (decisions.length > 100)
    throw new Error("Native settled quarantine history exceeds bound");
  if (decisions.length === 0) return [];
  const rows = await tx.nativeQuarantineContinuation.findMany({
    where: {
      state: "restored",
      OR: mediaIds.map((id) => ({
        descriptor: { path: ["group", "mediaIds"], array_contains: [id] },
      })),
    },
    include: { receipt: { include: { plan: true } } },
    orderBy: { id: "asc" },
    take: Math.floor((budget.take - 1) / 2) + 1,
  });
  budget.consume(rows.length * 2);
  if (rows.length > 100)
    throw new Error("Native settled continuation lookup exceeds bound");
  const settled: z.infer<typeof SettledNativeQuarantineSchema>[] = [];
  for (const row of rows) {
    await validateNativePlexReceipt(tx, row.receipt, budget);
    const descriptor = NativeQuarantineContinuationSchema.parse(row.descriptor);
    if (
      !descriptor.group.decisions.some((item) =>
        decisions.some((decision) => decision.id === item.id),
      )
    )
      continue;
    const restored = assertSettledReceipt(row, descriptor, files);
    assertSettledDecisions(descriptor, decisions);
    const dependencies = await assertSettledFiles(
      tx,
      { descriptor, restored, files },
      budget,
    );
    settled.push(
      SettledNativeQuarantineSchema.parse({
        continuationId: row.id,
        receiptId: row.receiptId,
        receiptHash: row.receipt.planHash,
        descriptorHash: digest(descriptor),
        decisionIds: descriptor.group.decisions.map((item) => item.id),
        restoration: restored,
        participants: descriptor.participants,
        ...dependencies,
      }),
    );
  }
  if (
    decisions.some(
      (decision) =>
        settled.filter((item) => item.decisionIds.includes(decision.id))
          .length !== 1,
    )
  )
    throw new Error(
      "Native quarantine history lacks exact completed restoration",
    );
  return settled;
}

type Row = Prisma.NativeQuarantineContinuationGetPayload<{
  include: { receipt: { include: { plan: true } } };
}>;
type Descriptor = z.infer<typeof NativeQuarantineContinuationSchema>;
function assertSettledReceipt(row: Row, descriptor: Descriptor, files: File[]) {
  if (
    descriptor.group.assetIds.some(
      (id) => !files.some((file) => file.assetId === id),
    ) ||
    row.receipt.plan.state !== "applied" ||
    row.receipt.planHash !== row.receipt.plan.planHash ||
    row.receipt.recoveryEpoch !== row.recoveryEpoch
  )
    throw new Error("Native settled quarantine receipt changed");
  const selection = z
    .object({
      scope: NativeQuarantineScopeSchema,
      bindings: z.array(NativeQuarantineBindingSchema),
    })
    .parse(row.receipt.selection);
  const finished = z
    .union([FinishedNativeV2Schema, FinishedQuarantinePlexV3Schema])
    .parse(row.receipt.plan.plan);
  const restored = NativeQuarantineRestorationSchema.parse(row.restoration);
  if (
    finished.lifecycleKind !== "committed_quarantine" ||
    digest(finished) !== row.receipt.planHash ||
    finished.scopeHash !== digest(selection.scope) ||
    digest(selection.scope) !== digest(row.receipt.plan.scope) ||
    !selection.scope.groups.some(
      (group) => digest(group) === digest(descriptor.group),
    ) ||
    restored.continuationId !== row.id ||
    restored.recoveryEpoch !== row.recoveryEpoch ||
    digest(restored.mediaIds) !== digest(descriptor.group.mediaIds) ||
    digest(descriptor.files) !==
      digest(
        selection.scope.files.filter((file) =>
          descriptor.group.assetIds.includes(file.assetId),
        ),
      ) ||
    digest(descriptor.bindings) !==
      digest(
        selection.bindings.filter((binding) =>
          descriptor.group.assetIds.includes(binding.assetId),
        ),
      )
  )
    throw new Error("Native settled quarantine evidence changed");

  return restored;
}
function assertSettledDecisions(
  descriptor: Descriptor,
  decisions: Prisma.RetentionDecisionGetPayload<object>[],
) {
  for (const original of descriptor.group.decisions) {
    const current = decisions.find((decision) => decision.id === original.id);
    if (
      current?.mediaId !== original.mediaId ||
      current.version < original.version ||
      current.generation !== original.generation ||
      digest(current.manifest) !== digest(original.manifest) ||
      digest(current.evidence) !== digest(original.evidence) ||
      current.quarantinedAt?.toISOString() !== original.quarantinedAt ||
      current.purgeAfter?.toISOString() !== original.purgeAfter
    )
      throw new Error("Native settled quarantine decision changed");
  }
}
async function assertSettledFiles(
  tx: Prisma.TransactionClient,
  {
    descriptor,
    restored,
    files,
  }: {
    descriptor: Descriptor;
    restored: z.infer<typeof NativeQuarantineRestorationSchema>;
    files: File[];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const replacementFiles = [];
  const replacementJournals = [];
  const history = [];
  const installations = [];
  for (const prior of descriptor.files) {
    const current = files.find((file) => file.assetId === prior.assetId);
    const binding = descriptor.bindings.find(
      (item) => item.assetId === prior.assetId,
    );
    const restoration = restored.assets.find(
      (item) => item.assetId === prior.assetId,
    );
    if (
      current === undefined ||
      binding === undefined ||
      restoration?.assetVersion !== binding.assetVersion + 1 ||
      restoration.checksum !== prior.checksum
    )
      throw new Error("Native settled quarantine asset changed");
    const {
      groupHash: _group,
      quarantineId: _quarantine,
      libraryPath: _path,
      sidecars: _sidecars,
      ...base
    } = prior;
    const expected = {
      ...base,
      assetVersion: restoration.assetVersion,
      ownershipEpoch: restored.recoveryEpoch,
      subtitles: prior.subtitles.map((subtitle) => ({
        ...subtitle,
        state: "installed" as const,
        version: subtitle.version + 2,
        videoVersion: restoration.assetVersion,
        ownershipEpoch: restored.recoveryEpoch,
      })),
    };
    const asset = {
      id: current.assetId,
      path: current.canonicalPath,
      checksum: current.checksum,
      version: current.assetVersion,
      ownershipEpoch: current.ownershipEpoch,
      coverage: current.mediaIds.map((mediaId) => ({ mediaId, current: true })),
    };
    const chain = await terminalRebindingChain(
      tx,
      {
        asset,
        originalVersion: restoration.assetVersion,
        originalEpoch: restored.recoveryEpoch,
      },
      budget,
    );
    history.push(chain);
    const { subtitles: _currentSubtitles, ...currentVideo } = current;
    const { subtitles: _expectedSubtitles, ...expectedVideo } = expected;
    if (
      digest(currentVideo) !==
      digest({
        ...expectedVideo,
        assetVersion: current.assetVersion,
        ownershipEpoch: current.ownershipEpoch,
      })
    )
      throw new Error("Native settled video identity changed");
    const matched: string[] = [];
    for (const subtitle of expected.subtitles) {
      const proof = await settledSubtitle(
        tx,
        {
          subtitle,
          current,
          chain,
          restored,
          asset,
        },
        budget,
      );
      matched.push(proof.id);
      replacementFiles.push(...proof.files);
      replacementJournals.push(...proof.journals);
      history.push(proof.history);
    }
    if (new Set(matched).size !== matched.length)
      throw new Error("Native settled subtitle coverage changed");
    for (const subtitle of current.subtitles.filter(
      (item) => !matched.includes(item.id),
    )) {
      const installed = await settledInstalledSubtitle(
        tx,
        {
          subtitle,
          chain,
          video: {
            path: current.canonicalPath,
            checksum: current.checksum,
            mediaIds: current.mediaIds,
            libraryKind: current.libraryKind,
          },
          videoBindings: [
            {
              version: restoration.assetVersion,
              epoch: restored.recoveryEpoch,
            },
            ...chain.map((item) => ({
              version: item.binding.assetVersion,
              epoch: item.binding.ownershipEpoch,
            })),
          ],
        },
        budget,
      );
      installations.push(installed.installation);
      history.push(installed.history);
    }
  }
  return {
    replacementFiles,
    replacementJournals,
    historyDigest: digest(nativeJson(history)),
    ...(installations.length === 0 ? {} : { installations }),
  };
}

async function settledSubtitle(
  tx: Prisma.TransactionClient,
  {
    subtitle,
    current,
    chain,
    restored,
    asset,
  }: {
    subtitle: File["subtitles"][number];
    current: File;
    chain: Awaited<ReturnType<typeof terminalRebindingChain>>;
    restored: z.infer<typeof NativeQuarantineRestorationSchema>;
    asset: Parameters<typeof terminalRebindingChain>[1]["asset"];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const unchanged = {
    ...subtitle,
    version: subtitle.version + chain.length,
    videoVersion: current.assetVersion,
    ownershipEpoch: current.ownershipEpoch,
  };
  if (subtitle.storageKind === "embedded") {
    const actual = current.subtitles.find((item) => item.id === subtitle.id);
    if (digest(actual) !== digest(unchanged))
      throw new Error("Native settled embedded subtitle changed");
    return { id: subtitle.id, files: [], journals: [], history: [] };
  }
  const replacement = await terminalSubtitleChain(
    tx,
    {
      subtitleId: subtitle.id,
      checksum: z.string().parse(subtitle.checksum),
      canonicalPath: z.string().parse(subtitle.path),
      libraryKind: current.libraryKind,
      asset,
      videoBindings: [
        { version: subtitle.videoVersion, epoch: restored.recoveryEpoch },
        ...chain.map((item) => ({
          version: item.binding.assetVersion,
          epoch: item.binding.ownershipEpoch,
        })),
      ],
      subtitleRenewals: chain.map((item) => ({
        bindings: item.binding.subtitles,
        snapshots: item.subtitleSnapshots,
      })),
    },
    budget,
  );
  const actual = current.subtitles.find(
    (item) => item.id === replacement.current.id,
  );
  if (
    actual === undefined ||
    (replacement.history.length === 0 && digest(actual) !== digest(unchanged))
  )
    throw new Error("Native settled sidecar binding changed");
  return {
    id: actual.id,
    files: replacement.files,
    journals: replacement.journals,
    history: replacement.history,
  };
}
