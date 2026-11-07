import path from "node:path";
import { z } from "zod";
import type { Prisma, Torrent } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { SeriesPackNativeDescriptorV2Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import { lockSeriesPackNativeScopeV1 } from "#infrastructure/native-compensation/series-pack/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { PendingLegacyClaimsError } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import {
  recordOutcome,
  sourceDirectoryExclusive,
} from "#automation/seeding.ts";
import { evaluateSeeding } from "#domain/seeding.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import {
  RecordedSeedingPolicySchema,
  CleanupReasonSchema,
  type CleanupEvaluation,
} from "#shared/visibility/seeding.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import {
  nativeSeriesPackSourceParentV1,
  nativeSeriesPackSourceCohortV1,
} from "./cohort.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";

type Outcome = Pick<CleanupEvaluation, "status" | "reason">;
type Phase = CleanupEvaluation["phase"];
type Invocation = NonNullable<MediaAutomationContext["movieManagement"]>;
type Context = MediaAutomationContext & { movieManagement: Invocation };
type Selection = Prisma.NativePublicationCompensationContinuationGetPayload<
  Record<string, never>
>;
type Input = { operationId: string; torrentId: string };
type Cohort = NonNullable<
  Awaited<ReturnType<typeof nativeSeriesPackSourceCohortV1>>
>;
const ProtectionSchema = z.union([
  z.instanceof(NativeArchiveScopeProtection),
  z.instanceof(PlexBindingProtection),
  z.instanceof(NativeCompensationProtection),
  z.instanceof(PendingLegacyClaimsError),
]);

function evaluationStatus(evaluated: ReturnType<typeof evaluateSeeding>) {
  if (evaluated.eligible) return "removable";
  return evaluated.reason === "seeding_required" ? "seeding" : "protected";
}

function isolatedObservation(
  savePath: string,
  contentPath: string,
  isolated: string,
) {
  const content = path.resolve(contentPath);
  return (
    path.resolve(savePath) === isolated &&
    (content === isolated || content.startsWith(`${isolated}/`))
  );
}

function sourceClaimCurrent(current: string, before: string, claimed: boolean) {
  return (
    current === (claimed ? "removing" : before) &&
    (claimed || current !== "removing")
  );
}

async function record(
  tx: Prisma.TransactionClient,
  torrent: Torrent,
  input: { phase: Phase; epoch: number },
  result: Outcome,
): Promise<Outcome> {
  await recordOutcome(
    tx,
    torrent,
    { phase: input.phase, evaluatedAt: new Date(), recoveryEpoch: input.epoch },
    result,
  );
  return result;
}

/** New descriptor2 only. Caller captured SDK+100 before lazy import. Old source
 * states and birth epochs are never normalized into current acquisition work. */
export async function scopedNativeSeriesPackSeedingV1(
  initial: MediaAutomationContext,
  raw: Input,
  phase: Phase,
): Promise<Outcome | null> {
  const invocation = initial.movieManagement;
  if (invocation === undefined)
    throw new Error(
      "Native pack source requires its original pre-lazy invocation",
    );
  const context = { ...initial, movieManagement: invocation };
  const { budget, execution } = invocation;
  execution.assertActive();
  const selected =
    await context.db.nativePublicationCompensationContinuation.findMany({
      where: {
        descriptor: { path: ["schemaVersion"], equals: 2 },
        transition: { attempt: { torrentId: raw.torrentId } },
      },
      orderBy: { recoveryEpoch: "desc" },
      take: 2,
    });
  budget.consume(selected.length);
  if (selected.length === 0) return null;
  const command = await context.db.operation.findUniqueOrThrow({
    where: { id: raw.operationId },
    select: { payload: true },
  });
  budget.consume(1);
  const envelope = z.record(z.string(), z.json()).parse(command.payload);
  // A genuine historical maintain command remains its literal protocol. Only
  // the actual persisted marker selects this new native authority consumer.
  if (!Object.hasOwn(envelope, "seriesPackNativeSourceV1")) return null;
  if (selected.length !== 1 || selected[0] === undefined)
    throw new NativeArchiveScopeProtection("source_dependencies_changed");
  const target = selected[0];
  const input = z
    .strictObject({ operationId: z.uuid(), torrentId: z.uuid() })
    .parse({ operationId: raw.operationId, torrentId: raw.torrentId });
  const torrent = await context.db.torrent.findUniqueOrThrow({
    where: { id: input.torrentId },
  });
  budget.consume(1);
  let claimed = false;
  if (
    phase === "removal" &&
    torrent.state !== "removed" &&
    torrent.state !== "removing"
  ) {
    const claim = await context.db.torrent.updateMany({
      where: { id: torrent.id, state: torrent.state },
      data: { state: "removing" },
    });
    if (claim.count !== 1)
      return record(
        context.db,
        torrent,
        { phase, epoch: target.recoveryEpoch },
        {
          status: "protected",
          reason: "removal_outcome_unknown",
        },
      );
    claimed = true;
  }
  const mutation = { started: false };
  try {
    return await context.db.$transaction(
      (tx) =>
        underLocks(
          tx,
          context,
          { target, input, torrent, phase, claimed },
          mutation,
        ),
      { timeout: 30_000 },
    );
  } catch (error) {
    // The independent durable claim survives a TX rollback after an uncertain
    // qBittorrent reply. Only a proven pre-effect failure may release our claim.
    if (claimed && !mutation.started)
      await context.db.torrent.updateMany({
        where: { id: torrent.id, state: "removing" },
        data: { state: torrent.state },
      });
    if (!mutation.started && ProtectionSchema.safeParse(error).success)
      return record(
        context.db,
        torrent,
        { phase, epoch: target.recoveryEpoch },
        {
          status: "protected",
          reason: "source_dependencies_changed",
        },
      );
    throw error;
  }
}

async function underLocks(
  tx: Prisma.TransactionClient,
  context: Context,
  input: {
    target: Selection;
    input: Input;
    torrent: Torrent;
    phase: Phase;
    claimed: boolean;
  },
  mutation: { started: boolean },
): Promise<Outcome> {
  const { target, phase, torrent: before } = input;
  const { execution, budget } = context.movieManagement;
  execution.assertActive();
  const sqlFreshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      execution.expiresAtMs,
      execution.observed.wall + 30_000,
    ),
    guards: [execution],
  });
  await bindPlexTransactionDeadline(tx, sqlFreshness);
  const descriptor = SeriesPackNativeDescriptorV2Schema.parse(
    target.descriptor,
  );
  if (identityHash(target.descriptor) !== target.descriptorHash)
    throw new Error("Native source locator descriptor hash changed");
  await lockSeriesPackNativeScopeV1(tx, descriptor.scope.publication);
  await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${before.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.input.operationId} FOR UPDATE`;
  const parent = await nativeSeriesPackSourceParentV1(
    tx,
    { ...input.input, continuationId: target.id },
    budget,
  );
  const current = await tx.torrent.findUniqueOrThrow({
    where: { id: before.id },
  });
  budget.consume(1);
  const epoch =
    parent?.publication.record.row.recoveryEpoch ?? target.recoveryEpoch;
  const protect = async (reason: NonNullable<Outcome["reason"]>) => {
    if (input.claimed)
      await tx.torrent.updateMany({
        where: { id: current.id, state: "removing" },
        data: { state: before.state },
      });
    return record(
      tx,
      current,
      { phase, epoch },
      { status: "protected", reason },
    );
  };
  if (parent === null) return protect("source_dependencies_changed");
  if (current.state === "removed")
    return record(
      tx,
      current,
      { phase, epoch },
      {
        status: "removed",
        reason: null,
      },
    );
  if (!sourceClaimCurrent(current.state, before.state, input.claimed))
    return protect("removal_outcome_unknown");
  const runtime = await runtimeAuthority(tx);
  if (
    !runtime.active ||
    runtime.epoch !== epoch ||
    !(await context.gates.sourceCleanup())
  )
    return protect("source_cleanup_disabled");
  await assertNativeExclusion(tx);
  await context.qbittorrent.login(execution.signal);
  const observed = await context.qbittorrent.observe(
    current.infoHash,
    execution.signal,
  );
  sqlFreshness.assertActive();
  if (observed === null) return protect("torrent_missing");
  if (!hasApplicationSeedingPolicy(observed))
    return protect("torrent_policy_drift");
  const files = await context.qbittorrent.files(
    observed.hash,
    execution.signal,
  );
  sqlFreshness.assertActive();
  const cohort = await nativeSeriesPackSourceCohortV1(
    tx,
    context,
    { parent, torrent: current, observed, files },
    budget,
  );
  if (cohort === null) return protect("source_dependencies_changed");
  if (
    !isolatedObservation(
      observed.save_path,
      observed.content_path,
      cohort.isolated,
    )
  )
    return protect("source_ownership_unproven");
  const stored = await tx.torrent.update({
    where: { id: current.id },
    data: { observation: { torrent: observed, files }, observedAt: new Date() },
  });
  const evaluated = evaluateSeeding(
    RecordedSeedingPolicySchema.parse(current.seedingPolicy),
    {
      ratio:
        observed.ratio.kind === "finite"
          ? observed.ratio.value
          : observed.ratio,
      seedingSeconds: observed.seeding_time,
      sizeBytes: observed.size,
      complete: observed.progress === 1,
      owned: current.owned,
      dependenciesRemaining: false,
    },
  );
  if (phase === "evaluation" || !evaluated.eligible) {
    if (input.claimed)
      await tx.torrent.updateMany({
        where: { id: current.id, state: "removing" },
        data: { state: before.state },
      });
    sqlFreshness.assertActive();
    return record(
      tx,
      stored,
      { phase, epoch },
      {
        status: evaluationStatus(evaluated),
        reason: CleanupReasonSchema.parse(evaluated.reason),
      },
    );
  }
  return removeNativeSourceV1(
    tx,
    context,
    {
      descriptor,
      cohort,
      current,
      stored,
      observed,
      epoch,
      phase,
      sqlFreshness,
      protect,
    },
    mutation,
  );
}

async function removeNativeSourceV1(
  tx: Prisma.TransactionClient,
  context: Context,
  input: {
    descriptor: z.infer<typeof SeriesPackNativeDescriptorV2Schema>;
    cohort: Cohort;
    current: Torrent;
    stored: Torrent;
    observed: TorrentObservation;
    epoch: number;
    phase: Phase;
    sqlFreshness: PlexBindingFreshness;
    protect: (reason: NonNullable<Outcome["reason"]>) => Promise<Outcome>;
  },
  mutation: { started: boolean },
): Promise<Outcome> {
  const {
    descriptor,
    cohort,
    current,
    stored,
    observed,
    epoch,
    phase,
    sqlFreshness,
    protect,
  } = input;
  const { execution, budget } = context.movieManagement;
  if (
    !(await sourceDirectoryExclusive(context, observed.hash, cohort.isolated))
  )
    return protect("source_directory_shared");
  const writer = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const roots = await tx.mediaStorageAuthority.findMany({
    where: {
      rootPath: {
        in: descriptor.scope.storageRoots.map((root) => root.rootPath),
      },
    },
  });
  budget.consume(1 + roots.length);
  const now = Date.now();
  if (
    roots.length !== descriptor.scope.storageRoots.length ||
    roots.some(
      (root) =>
        root.recoveryEpoch !== epoch ||
        root.revokedAt !== null ||
        root.observedAt.getTime() > now ||
        root.expiresAt.getTime() <= now ||
        root.expiresAt.getTime() - root.observedAt.getTime() > 120_000,
    )
  )
    return protect("source_dependencies_changed");
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      sqlFreshness.expiresAtMs,
      writer.expiresAt.getTime(),
      ...roots.map((root) => root.expiresAt.getTime()),
    ),
    guards: [sqlFreshness],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  freshness.assertActive();
  await context.qbittorrent.remove(
    {
      hash: current.infoHash,
      operationId: cohort.owner.operationId,
      attemptId: cohort.owner.id,
      savePath: cohort.isolated,
      deleteFiles: true,
    },
    execution.signal,
    () => {
      freshness.assertActive();
      mutation.started = true;
    },
  );
  freshness.assertActive();
  if (!mutation.started) return protect("torrent_missing");
  await tx.torrent.update({
    where: { id: current.id },
    data: { state: "removed" },
  });
  return record(
    tx,
    stored,
    { phase, epoch },
    { status: "removed", reason: null },
  );
}
