import { readRuntimeProof } from "#infrastructure/handoff/runtime-proof.ts";
import { seedingObservation } from "#automation/seeding/observation.ts";
import path from "node:path";
import type { Prisma, Torrent } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { seriesPackSettledSourceCohortV1 } from "./series-pack-cohort.ts";
import {
  recordOutcome,
  sourceDirectoryExclusive,
} from "#automation/seeding.ts";
import {
  RecordedSeedingPolicySchema,
  CleanupReasonSchema,
  type CleanupEvaluation,
} from "#shared/visibility/seeding.ts";
import { evaluateSeeding } from "#domain/seeding.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";

type Phase = CleanupEvaluation["phase"];
type Context = ReturnType<typeof movieManagementContext>;
type Outcome = {
  status: CleanupEvaluation["status"];
  reason: CleanupEvaluation["reason"];
};
type Selected = { id: string; mediaIds: string[]; recoveryEpoch: number };

function exactIsolatedPath(observed: TorrentObservation, isolated: string) {
  const content = path.resolve(observed.content_path);
  return (
    path.resolve(observed.save_path) === isolated &&
    (content === isolated || content.startsWith(`${isolated}/`))
  );
}

function evaluatedStatus(evaluated: ReturnType<typeof evaluateSeeding>) {
  if (evaluated.eligible) return "removable";
  return evaluated.reason === "seeding_required" ? "seeding" : "protected";
}

async function selectedOwner(context: Context, torrentId: string) {
  const owner = await context.db.acquisitionAttempt.findFirst({
    where: {
      torrentId,
      publicationTransition: {
        is: { intent: { path: ["schemaVersion"], equals: 3 } },
      },
      OR: [
        { state: "rolled_back" },
        {
          state: "completed",
          publicationTransition: {
            is: {
              intent: { path: ["schemaVersion"], equals: 3 },
              outcome: { path: ["kind"], equals: "published" },
            },
          },
        },
        {
          state: "obsolete",
          publicationTransition: {
            is: {
              intent: { path: ["schemaVersion"], equals: 3 },
              outcome: { path: ["kind"], equals: "compensated" },
            },
          },
        },
      ],
      identityEvidence: {
        path: ["source", "seriesPackV1", "schemaVersion"],
        equals: 1,
      },
    },
    select: { id: true, mediaIds: true, recoveryEpoch: true },
  });
  context.movieManagement.budget.consume(owner === null ? 0 : 1);
  return owner;
}

async function record(
  tx: Prisma.TransactionClient,
  torrent: Torrent,
  phase: Phase,
  outcome: Outcome,
) {
  await recordOutcome(
    tx,
    torrent,
    { phase, evaluatedAt: new Date(), recoveryEpoch: torrent.ownershipEpoch },
    outcome,
  );
  return outcome;
}

/** Whole-cohort v3 settled-publication independence, once per Activity under one held
 * transaction. Old completed/cancelled source semantics remain separate. */
export async function scopedSeriesPackSeeding(
  initial: MediaAutomationContext,
  torrentId: string,
  phase: Phase,
) {
  const context = movieManagementContext(initial);
  const { execution, budget } = context.movieManagement;
  execution.assertActive();
  const selected = await selectedOwner(context, torrentId);
  if (selected === null) return null;
  const torrent = await context.db.torrent.findUniqueOrThrow({
    where: { id: torrentId },
  });
  budget.consume(1);
  if (torrent.state === "removed")
    return record(context.db, torrent, phase, {
      status: "removed",
      reason: null,
    });
  if (torrent.state === "removing")
    return record(context.db, torrent, phase, {
      status: "protected",
      reason: "removal_outcome_unknown",
    });
  if (phase === "removal") {
    const claim = await context.db.torrent.updateMany({
      where: { id: torrent.id, state: torrent.state },
      data: { state: "removing" },
    });
    if (claim.count !== 1)
      return record(context.db, torrent, phase, {
        status: "protected",
        reason: "removal_outcome_unknown",
      });
  }
  const mutation = { started: false };
  try {
    return await context.db.$transaction(
      (tx) => underLocks(tx, context, { selected, torrent, phase }, mutation),
      { timeout: 60_000 },
    );
  } catch (error) {
    if (phase === "removal" && !mutation.started)
      await context.db.torrent.updateMany({
        where: { id: torrent.id, state: "removing" },
        data: { state: torrent.state },
      });
    if (
      !mutation.started &&
      (error instanceof NativeArchiveScopeProtection ||
        error instanceof PlexBindingProtection)
    )
      return record(context.db, torrent, phase, {
        status: "protected",
        reason: "source_dependencies_changed",
      });
    throw error;
  }
}

async function underLocks(
  tx: Prisma.TransactionClient,
  context: Context,
  input: { selected: Selected; torrent: Torrent; phase: Phase },
  mutation: { started: boolean },
): Promise<Outcome> {
  const { selected, phase, torrent: prior } = input;
  const { execution, budget } = context.movieManagement;
  execution.assertActive();
  await lockAcquisitionMedia(tx, selected.mediaIds);
  const active = await lockRuntimeAuthority(tx, selected.recoveryEpoch);
  await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${prior.id} FOR UPDATE`;
  const current = await tx.torrent.findUniqueOrThrow({
    where: { id: prior.id },
  });
  budget.consume(1);
  let snapshot = current;
  const protect = async (
    reason: NonNullable<Outcome["reason"]>,
  ): Promise<Outcome> => {
    if (phase === "removal")
      await tx.torrent.updateMany({
        where: { id: current.id, state: "removing" },
        data: { state: prior.state },
      });
    return record(tx, snapshot, phase, { status: "protected", reason });
  };
  if (
    !active ||
    current.ownershipEpoch !== selected.recoveryEpoch ||
    !(await context.gates.sourceCleanup())
  )
    return protect("source_cleanup_disabled");
  if (current.state !== (phase === "removal" ? "removing" : prior.state))
    return protect("removal_outcome_unknown");
  await context.qbittorrent.login(execution.signal);
  const observed = await context.qbittorrent.observe(
    current.infoHash,
    execution.signal,
  );
  execution.assertActive();
  if (observed === null) return protect("torrent_missing");
  if (!hasApplicationSeedingPolicy(observed))
    return protect("torrent_policy_drift");
  const files = await context.qbittorrent.files(
    observed.hash,
    execution.signal,
  );
  execution.assertActive();
  const dependencies = await seriesPackSettledSourceCohortV1(
    tx,
    context,
    { torrent: current, attemptId: selected.id, observed, files },
    budget,
  );
  if (dependencies === null) return protect("source_dependencies_changed");
  const { owner, isolated } = dependencies;
  if (!exactIsolatedPath(observed, isolated))
    return protect("source_ownership_unproven");
  const stored = await tx.torrent.update({
    where: { id: current.id },
    data: { observation: { torrent: observed, files }, observedAt: new Date() },
  });
  snapshot = stored;
  const evaluated = evaluateSeeding(
    RecordedSeedingPolicySchema.parse(current.seedingPolicy),
    seedingObservation(observed, current.owned),
  );
  if (phase === "evaluation" || !evaluated.eligible) {
    if (phase === "removal")
      await tx.torrent.updateMany({
        where: { id: current.id, state: "removing" },
        data: { state: prior.state },
      });
    return record(tx, stored, phase, {
      status: evaluatedStatus(evaluated),
      reason: CleanupReasonSchema.parse(evaluated.reason),
    });
  }
  if (!(await sourceDirectoryExclusive(context, observed.hash, isolated)))
    return protect("source_directory_shared");
  const writer = await readRuntimeProof(tx);
  budget.consume(1);
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(execution.expiresAtMs, writer.expiresAt.getTime()),
    guards: [execution],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  freshness.assertActive();
  await context.qbittorrent.remove(
    {
      hash: current.infoHash,
      operationId: owner.operationId,
      attemptId: owner.id,
      savePath: isolated,
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
  return record(tx, stored, phase, { status: "removed", reason: null });
}
