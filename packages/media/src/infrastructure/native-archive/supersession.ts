import { createHash } from "node:crypto";
import { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveContinuationSchema,
  NativeArchiveExecutionSchema,
  NativeArchiveSupersessionSchema,
  NativeArchiveSupersessionTargetSchema,
  type NativeArchiveScope,
  type NativeArchiveFileEvidence,
  type NativeArchiveNetworkEvidence,
} from "#shared/native-recovery/archive.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import { NativeArchiveScopeProtection } from "./errors.ts";
import { stableArchiveFiles } from "./plan.ts";
import { z } from "zod";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { ArchiveReceiptProjection } from "./receipt-projection.ts";

type SupersessionScope = {
  files: NativeArchiveScope["files"];
  request: Pick<NativeArchiveScope["request"], "cleanupIds" | "recoveryEpoch">;
};

async function supersessionRecord(
  tx: Prisma.TransactionClient,
  id: string,
  budget: PublicationAuthorityReadBudget,
  projection: ArchiveReceiptProjection,
) {
  budget.consume(3);
  const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id },
    include: { receipt: { include: { plan: true } } },
  });
  const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
  await projection.validateQueried(tx, row.receipt, budget);
  const finished = z
    .object({ scopeHash: z.string(), files: z.json() })
    .parse(row.receipt.plan.plan);
  const selection = z
    .object({
      scope: z.json(),
      fileEvidence: z.json(),
      bindings: z.json(),
      reusedBindings: z.json(),
    })
    .parse(row.receipt.selection);
  if (
    snapshotHash(nativeJson(row.descriptor)) !== row.descriptorHash ||
    row.receipt.plan.state !== "applied" ||
    row.receipt.planHash !== row.receipt.plan.planHash ||
    snapshotHash(nativeJson(row.receipt.plan.plan)) !== row.receipt.planHash ||
    snapshotHash(nativeJson(row.receipt.plan.scope)) !== finished.scopeHash ||
    snapshotHash(nativeJson(descriptor.scope)) !== finished.scopeHash ||
    snapshotHash(selection.scope) !== finished.scopeHash ||
    snapshotHash(selection.fileEvidence) !== snapshotHash(finished.files) ||
    snapshotHash(nativeJson(stableArchiveFiles(descriptor.fileEvidence))) !==
      snapshotHash(selection.fileEvidence) ||
    snapshotHash(selection.bindings) !== snapshotHash(descriptor.bindings) ||
    snapshotHash(selection.reusedBindings) !==
      snapshotHash(nativeJson(descriptor.reusedBindings)) ||
    row.receipt.recoveryEpoch !== row.recoveryEpoch ||
    row.receipt.plan.recoveryEpoch !== row.recoveryEpoch ||
    descriptor.selectedCleanupId !== row.originalCleanupId
  )
    throw new Error("Archive supersession parent changed");
  return { row, descriptor };
}

export async function deriveArchiveSupersessions(
  tx: Prisma.TransactionClient,
  scope: SupersessionScope,
  budget = new PublicationAuthorityReadBudget(),
  projection = new ArchiveReceiptProjection(tx, budget),
) {
  const captured = await captureSupersessions(tx, scope, budget, projection);
  return captured.targets;
}

async function captureSupersessions(
  tx: Prisma.TransactionClient,
  scope: SupersessionScope,
  budget: PublicationAuthorityReadBudget,
  projection: ArchiveReceiptProjection,
) {
  const rows = await tx.nativeArchiveCleanupContinuation.findMany({
    where: {
      originalCleanupId: { in: scope.request.cleanupIds },
      recoveryEpoch: scope.request.recoveryEpoch,
      state: { not: "superseded" },
    },
    orderBy: { id: "asc" },
    take: Math.min(26, budget.take),
  });
  budget.consume(rows.length);
  if (rows.length > 25)
    throw new NativeArchiveScopeProtection(
      "Archive supersession scope exceeds bound",
    );
  const targets = [];
  const records = [];
  for (const initial of rows) {
    const record = await supersessionRecord(tx, initial.id, budget, projection);
    const { row, descriptor } = record;
    records.push(record);
    const previousServing = new Set(
      descriptor.scope.currentPlayback.map((item) => item.assetId),
    );
    const changed = scope.files.filter(
      (file) =>
        file.role === "current_playback" && !previousServing.has(file.assetId),
    );
    if (changed.length === 0)
      throw new NativeArchiveScopeProtection(
        "Archive cleanup already has current authority",
      );
    if (
      row.completion !== null ||
      row.coordinatorOperationId === null ||
      !["pending", "cleaning", "protected"].includes(row.state)
    )
      throw new NativeArchiveScopeProtection(
        "Archive prior continuation requires exact terminal no-effect reconciliation",
      );
    for (const file of changed)
      await assertChangedPlayback(tx, file, previousServing, budget);
    targets.push(
      NativeArchiveSupersessionTargetSchema.parse({
        continuationId: row.id,
        receiptId: row.receiptId,
        originalCleanupId: row.originalCleanupId,
        version: row.version,
        descriptorHash: row.descriptorHash,
        coordinatorOperationId: row.coordinatorOperationId,
        executionHash:
          row.executionEvidence === null
            ? null
            : snapshotHash(nativeJson(row.executionEvidence)),
      }),
    );
  }
  return { targets, records };
}

/** Actual queried old continuations, consumed once within their locked snapshot TX. */
export class ArchiveSupersessionProjection {
  #scopeHash: string | null = null;
  #closed = false;
  readonly #rawHash: string;
  private constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly budget: PublicationAuthorityReadBudget,
    private readonly captured: Awaited<ReturnType<typeof captureSupersessions>>,
    private readonly inputHash: string,
  ) {
    this.#rawHash = snapshotHash(nativeJson(captured));
  }

  static async capture(
    tx: Prisma.TransactionClient,
    scope: SupersessionScope,
    budget: PublicationAuthorityReadBudget,
    projection: ArchiveReceiptProjection,
  ) {
    return new ArchiveSupersessionProjection(
      tx,
      budget,
      await captureSupersessions(tx, scope, budget, projection),
      supersessionScopeKey(scope),
    );
  }

  get targets() {
    return this.captured.targets;
  }

  bindScope(scope: NativeArchiveScope) {
    if (
      this.#scopeHash !== null ||
      this.inputHash !== supersessionScopeKey(scope) ||
      snapshotHash(nativeJson(scope.supersessions ?? [])) !==
        snapshotHash(nativeJson(this.targets))
    )
      throw new Error("Archive supersession projection scope changed");
    this.#scopeHash = snapshotHash(nativeJson(scope));
  }

  consume(
    tx: Prisma.TransactionClient,
    scope: NativeArchiveScope,
    budget: PublicationAuthorityReadBudget,
  ) {
    if (
      this.transaction !== tx ||
      this.budget !== budget ||
      this.#closed ||
      this.#scopeHash !== snapshotHash(nativeJson(scope)) ||
      this.#rawHash !== snapshotHash(nativeJson(this.captured))
    )
      throw new Error(
        "Archive supersession projection changed, consumed or belongs to another transaction/budget",
      );
    this.#closed = true;
    return this.captured.records;
  }
}

function supersessionScopeKey(scope: SupersessionScope) {
  return snapshotHash(
    nativeJson({
      files: scope.files,
      request: {
        cleanupIds: [...scope.request.cleanupIds].sort(),
        recoveryEpoch: scope.request.recoveryEpoch,
      },
    }),
  );
}

async function assertChangedPlayback(
  tx: Prisma.TransactionClient,
  file: NativeArchiveScope["files"][number],
  previousServing: ReadonlySet<string>,
  budget?: PublicationAuthorityReadBudget,
) {
  if (file.authority.kind !== "publication_transition_binding")
    throw new NativeArchiveScopeProtection(
      "Archive changed playback lacks adjacent publication proof",
    );
  budget?.consume(1);
  const transition = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: file.authority.transitionId },
  });
  const intent = await loadPublicationIntent(tx, transition.attemptId, budget);
  if (
    intent?.intent.entries.some(
      (entry) =>
        entry.entry.assetId === file.assetId &&
        entry.predecessor !== null &&
        previousServing.has(entry.predecessor.id),
    ) !== true
  )
    throw new NativeArchiveScopeProtection(
      "Archive changed playback is not the recorded adjacent transition",
    );
}

type SupersessionRecord = Awaited<ReturnType<typeof supersessionRecord>>;
type SupersessionEvidence = NonNullable<
  NativeArchiveFileEvidence["supersessionEvidence"]
>[number];
type ClosedCoordinator = NonNullable<
  NativeArchiveNetworkEvidence["supersededCoordinators"]
>[number]["closedCoordinator"];
type SupersessionInput = {
  scope: NativeArchiveScope;
  fileEvidence: NativeArchiveFileEvidence;
  networkEvidence: NativeArchiveNetworkEvidence;
  planId: string;
  receiptId: string;
  planHash: string;
};

function assertReviewedSupersession(
  row: SupersessionRecord["row"],
  target: z.infer<typeof NativeArchiveSupersessionTargetSchema>,
  proof: { evidence: SupersessionEvidence; closed: ClosedCoordinator },
  input: SupersessionInput,
) {
  const { evidence, closed } = proof;
  if (
    row.version !== target.version ||
    row.descriptorHash !== target.descriptorHash ||
    row.receiptId !== target.receiptId ||
    row.originalCleanupId !== target.originalCleanupId ||
    row.coordinatorOperationId !== target.coordinatorOperationId ||
    row.recoveryEpoch !== input.scope.request.recoveryEpoch ||
    row.completion !== null ||
    row.supersession !== null ||
    !["pending", "cleaning", "protected"].includes(row.state) ||
    closed.operationId !== row.coordinatorOperationId ||
    Date.parse(closed.observedAt) > Date.now() ||
    Date.parse(closed.observedAt) <
      Date.parse(input.networkEvidence.capturedAt) ||
    evidence.descriptorHash !== row.descriptorHash ||
    evidence.executionHash !== target.executionHash ||
    target.executionHash !==
      (row.executionEvidence === null
        ? null
        : snapshotHash(nativeJson(row.executionEvidence)))
  )
    throw new Error(
      "Archive supersession coordinator or reviewed identity changed",
    );
}

function assertSupersessionParticipant(
  record: SupersessionRecord,
  evidence: SupersessionEvidence,
  item: NativeArchiveScope["edges"][number]["derivedPlan"]["files"][number],
) {
  const { row, descriptor } = record;
  const participants = evidence.participants.filter(
    (entry) =>
      entry.canonicalPath === item.path &&
      entry.checksum === item.checksum &&
      entry.id === item.id &&
      entry.location === item.location,
  );
  const participant = participants[0];
  if (participant === undefined || participants.length !== 1)
    throw new Error("Archive supersession participant changed");
  const proof = descriptor.fileEvidence.files.find(
    (entry) => entry.assetId === participant.assetId,
  );
  const identity =
    participant.subtitleId === null
      ? proof
      : proof?.subtitles.find((entry) => entry.id === participant.subtitleId);
  if (
    identity?.canonicalPath !== participant.canonicalPath ||
    identity.checksum !== participant.checksum ||
    identity.sizeBytes !== participant.sizeBytes ||
    snapshotHash(nativeJson(identity.identity)) !==
      snapshotHash(nativeJson(participant.identity))
  )
    throw new Error(
      "Archive supersession no-effect identity differs from original review",
    );
  const operationId = `native-archive-${row.id}-${createHash("sha256").update(participant.canonicalPath).digest("hex").slice(0, 20)}`;
  if (
    evidence.absentJournals.filter(
      (entry) =>
        entry.libraryKind === participant.libraryKind &&
        entry.canonicalPath ===
          `/data/${participant.libraryKind}/.media-control/journal/${operationId}.json`,
    ).length !== 1
  )
    throw new Error("Archive supersession own purge journal absence missing");
}

function assertSupersessionParticipants(
  record: SupersessionRecord,
  evidence: SupersessionEvidence,
) {
  const { row, descriptor } = record;
  const edge = descriptor.scope.edges.find(
    (item) => item.id === row.originalCleanupId && item.selected,
  );
  if (
    edge?.derivedPlan.files.length !== evidence.participants.length ||
    evidence.absentJournals.length !== evidence.participants.length
  )
    throw new Error("Archive supersession omitted selected participants");
  for (const item of edge.derivedPlan.files)
    assertSupersessionParticipant(record, evidence, item);
}

/** Called only within Files' reviewed no-effect ContentProof and operation/path locks. */
export async function commitArchiveSupersessions(
  tx: Prisma.TransactionClient,
  input: SupersessionInput,
  budget = new PublicationAuthorityReadBudget(),
  {
    projection = new ArchiveReceiptProjection(tx, budget),
    supersessions,
  }: {
    projection?: ArchiveReceiptProjection;
    supersessions?: ArchiveSupersessionProjection;
  } = {},
): Promise<void> {
  projection.assertTransaction(tx, budget);
  const targets = input.scope.supersessions ?? [];
  const files = input.fileEvidence.supersessionEvidence ?? [];
  const network = input.networkEvidence.supersededCoordinators ?? [];
  if (targets.length !== files.length || targets.length !== network.length)
    throw new Error("Archive supersession evidence is incomplete");
  const captured = supersessions?.consume(tx, input.scope, budget);
  for (const target of targets) {
    const record =
      captured === undefined
        ? await supersessionRecord(
            tx,
            target.continuationId,
            budget,
            projection,
          )
        : captured.find((item) => item.row.id === target.continuationId);
    if (record === undefined)
      throw new Error("Archive supersession projection omitted target");
    const { row, descriptor } = record;
    const physical = files.filter((item) => item.continuationId === row.id);
    const terminal = network.filter((item) => item.continuationId === row.id);
    const evidence = physical[0];
    const closed = terminal[0]?.closedCoordinator;
    if (
      evidence === undefined ||
      closed === undefined ||
      physical.length !== 1 ||
      terminal.length !== 1
    )
      throw new Error(
        "Archive supersession coordinator or reviewed identity changed",
      );
    assertReviewedSupersession(row, target, { evidence, closed }, input);
    assertSupersessionParticipants({ row, descriptor }, evidence);
    if (
      row.executionEvidence !== null &&
      snapshotHash(
        NativeArchiveExecutionSchema.parse(row.executionEvidence).participants,
      ) !== snapshotHash(evidence.participants)
    )
      throw new Error(
        "Archive supersession allocated execution identity changed",
      );
    const supersession = NativeArchiveSupersessionSchema.parse({
      schemaVersion: 1,
      continuationId: row.id,
      descriptorHash: row.descriptorHash,
      replacingPlanId: input.planId,
      replacingReceiptId: input.receiptId,
      replacingPlanHash: input.planHash,
      target,
      closedCoordinator: closed,
      evidence,
      supersededAt: new Date().toISOString(),
    });
    await writeSupersession(tx, row, supersession);
  }
}

async function writeSupersession(
  tx: Prisma.TransactionClient,
  row: SupersessionRecord["row"],
  supersession: z.infer<typeof NativeArchiveSupersessionSchema>,
) {
  const changed = await tx.nativeArchiveCleanupContinuation.updateMany({
    where: {
      id: row.id,
      version: row.version,
      state: row.state,
      receiptId: row.receiptId,
      originalCleanupId: row.originalCleanupId,
      coordinatorOperationId: row.coordinatorOperationId,
      recoveryEpoch: row.recoveryEpoch,
      descriptorHash: row.descriptorHash,
      executionEvidence: {
        equals:
          row.executionEvidence === null
            ? Prisma.DbNull
            : z.record(z.string(), z.json()).parse(row.executionEvidence),
      },
      completion: { equals: Prisma.DbNull },
      supersession: { equals: Prisma.DbNull },
    },
    data: {
      state: "superseded",
      version: { increment: 1 },
      supersession: z.record(z.string(), z.json()).parse(supersession),
    },
  });
  if (changed.count !== 1)
    throw new Error("Archive supersession changed before its exact write");
}
