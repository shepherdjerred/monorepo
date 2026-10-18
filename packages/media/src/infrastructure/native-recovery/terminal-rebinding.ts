import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativePublishedScopeSchema,
  NativeStoredScopeSchema,
  FinishedNativeV2Schema,
} from "#shared/native-recovery/lifecycle.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import { NativeArchiveScopeSchema } from "#shared/native-recovery/archive.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export const TerminalSubtitleBindingSchema = z.object({
  id: z.uuid(),
  before: z.object({
    version: z.int(),
    ownershipEpoch: z.int(),
    videoVersion: z.int(),
  }),
  after: z.object({
    version: z.int(),
    ownershipEpoch: z.int(),
    videoVersion: z.int(),
  }),
  qualityStatus: z.enum(["accepted", "unverified", "rejected"]),
});

const Binding = z.object({
  assetId: z.uuid(),
  beforeVersion: z.int().nonnegative(),
  assetVersion: z.int().nonnegative(),
  checksum: z.string(),
  mediaIds: z.array(z.uuid()),
  ownershipEpoch: z.int().nonnegative(),
  subtitles: z.array(TerminalSubtitleBindingSchema),
});
const Selection = z.object({
  scope: z.json(),
  fileEvidence: z.json(),
  networkEvidence: z.json(),
  bindings: z.array(Binding),
});
const Finished = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    scopeHash: z.string(),
    network: z.json(),
    files: z.json(),
  }),
  FinishedNativeV2Schema,
]);

/** Only immutable native receipts may advance a terminal rollback's physical version. */
export async function terminalRebindingChain(
  tx: Prisma.TransactionClient,
  input: {
    asset: {
      id: string;
      version: number;
      ownershipEpoch: number;
      checksum: string | null;
      path: string;
      coverage: { mediaId: string; current: boolean }[];
    };
    originalVersion: number;
    originalEpoch: number;
  },
  budget?: PublicationAuthorityReadBudget,
) {
  const { asset } = input;
  const rows = await tx.nativeRecoveryReceipt.findMany({
    where: {
      selection: {
        path: ["bindings"],
        array_contains: [{ assetId: asset.id }],
      },
    },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
    take: budget?.take ?? 101,
  });
  budget?.consume(rows.length);
  if (rows.length > 100)
    throw new Error("Native terminal receipt chain exceeds bounded lookup");
  let version = asset.version;
  let epoch = asset.ownershipEpoch;
  const chain = [];
  const coverageHash = snapshotHash(
    asset.coverage
      .filter((row) => row.current)
      .map((row) => row.mediaId)
      .sort(),
  );
  while (version > input.originalVersion) {
    const matches = rows.flatMap((row) => {
      const storedScope = NativeStoredScopeSchema.parse(row.plan.scope);
      if (
        storedScope.schemaVersion === 2 &&
        storedScope.lifecycleKind === "committed_quarantine"
      )
        return [];
      const selection = Selection.parse(row.selection);
      return selection.bindings
        .filter(
          (binding) =>
            binding.assetId === asset.id &&
            binding.assetVersion === version &&
            binding.ownershipEpoch === epoch,
        )
        .map((binding) => ({ row, selection, binding }));
    });
    const match = matches[0];
    if (match === undefined || matches.length !== 1)
      throw new Error("Native terminal version has no unique receipt binding");
    const { row, selection, binding } = match;
    const scope = z
      .union([NativePublishedScopeSchema, NativeArchiveScopeSchema])
      .parse(row.plan.scope);
    const finished = Finished.parse(row.plan.plan);
    const files = scope.files.filter((file) => file.assetId === asset.id);
    const file = files[0];
    if (file === undefined || files.length !== 1)
      throw new Error("Native terminal receipt has no exact selected file");
    validateReceipt({ row, selection, finished });
    if (
      binding.beforeVersion !== version - 1 ||
      file.assetVersion !== binding.beforeVersion ||
      file.ownershipEpoch >= epoch ||
      binding.checksum !== asset.checksum ||
      file.checksum !== asset.checksum ||
      file.canonicalPath !== asset.path ||
      snapshotHash([...binding.mediaIds].sort()) !== coverageHash ||
      snapshotHash([...file.mediaIds].sort()) !== coverageHash ||
      row.recoveryEpoch !== epoch
    )
      throw new Error("Native terminal receipt physical binding changed");
    validateSubtitleBindings(binding, file.subtitles);
    chain.push({
      id: row.id,
      planHash: row.planHash,
      binding,
      subtitleSnapshots: file.subtitles.map((subtitle) =>
        NativeSubtitleSnapshotSchema.parse(subtitle),
      ),
    });
    version = binding.beforeVersion;
    epoch = file.ownershipEpoch;
  }
  assertOriginalBinding(version, epoch, input);
  return chain;
}

function assertOriginalBinding(
  version: number,
  epoch: number,
  input: { originalVersion: number; originalEpoch: number },
) {
  if (version !== input.originalVersion || epoch !== input.originalEpoch)
    throw new Error(
      "Native terminal receipt chain does not reach the original rollback",
    );
}

function validateSubtitleBindings(
  binding: z.infer<typeof Binding>,
  snapshots: Pick<
    z.infer<typeof NativeSubtitleSnapshotSchema>,
    "id" | "version" | "ownershipEpoch" | "videoVersion" | "qualityStatus"
  >[],
) {
  if (
    binding.subtitles.length !== snapshots.length ||
    new Set(binding.subtitles.map((item) => item.id)).size !== snapshots.length
  )
    throw new Error("Native terminal subtitle receipt coverage changed");
  for (const subtitle of snapshots) {
    const actual = binding.subtitles.find((item) => item.id === subtitle.id);
    const expected = {
      id: subtitle.id,
      before: {
        version: subtitle.version,
        ownershipEpoch: subtitle.ownershipEpoch,
        videoVersion: subtitle.videoVersion,
      },
      after: {
        version: subtitle.version + 1,
        ownershipEpoch: binding.ownershipEpoch,
        videoVersion: binding.assetVersion,
      },
      qualityStatus: subtitle.qualityStatus,
    };
    if (actual === undefined || snapshotHash(actual) !== snapshotHash(expected))
      throw new Error("Native terminal subtitle receipt binding changed");
  }
}

function validateReceipt({
  row,
  selection,
  finished,
}: {
  row: Prisma.NativeRecoveryReceiptGetPayload<{ include: { plan: true } }>;
  selection: z.infer<typeof Selection>;
  finished: z.infer<typeof Finished>;
}) {
  if (
    row.plan.state !== "applied" ||
    row.planId !== row.plan.id ||
    row.plan.recoveryEpoch !== row.recoveryEpoch ||
    row.plan.planHash !== row.planHash ||
    snapshotHash(finished) !== row.planHash ||
    snapshotHash(z.json().parse(row.plan.scope)) !== finished.scopeHash ||
    snapshotHash(selection.scope) !== finished.scopeHash ||
    snapshotHash(selection.fileEvidence) !== snapshotHash(finished.files) ||
    snapshotHash(selection.networkEvidence) !== snapshotHash(finished.network)
  )
    throw new Error(
      "Native terminal receipt has invalid immutable plan binding",
    );
}
