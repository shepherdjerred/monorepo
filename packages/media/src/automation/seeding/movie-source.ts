import path from "node:path";
import type { MediaAutomationContext } from "#automation/context.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import {
  movieSourceCohort,
  movieSourceDependencies,
  lockMovieSourceParticipants,
} from "./movie-cohort.ts";
import {
  recordOutcome,
  PolicySchema,
  sourceDirectoryExclusive,
} from "#automation/seeding.ts";
import { requireActiveRuntime } from "#automation/runtime.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { evaluateSeeding } from "#domain/seeding.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import type { CleanupEvaluation } from "#shared/visibility/seeding.ts";
import { CleanupReasonSchema } from "#shared/visibility/seeding.ts";
import type { CleanupSnapshot } from "#infrastructure/visibility/seeding.ts";
import { observeMovieSourceForSeeding } from "./movie-observation.ts";

type Reason = NonNullable<CleanupEvaluation["reason"]>;
type Cohort = Awaited<ReturnType<typeof movieSourceCohort>>;

function sameRemovalCohort(
  current: Cohort,
  previous: Cohort,
  recoveryEpoch: number,
) {
  return (
    current.state === "removing" &&
    current.owned &&
    current.ownershipEpoch === recoveryEpoch &&
    identityHash(current.seedingPolicy) ===
      identityHash(previous.seedingPolicy) &&
    identityHash(current.attempts.map((a) => a.id)) ===
      identityHash(previous.attempts.map((a) => a.id)) &&
    identityHash(current.assets.map((a) => a.id)) ===
      identityHash(previous.assets.map((a) => a.id))
  );
}

function evaluationStatus(evaluated: ReturnType<typeof evaluateSeeding>) {
  if (evaluated.eligible) return "removable";
  return evaluated.reason === "seeding_required" ? "seeding" : "protected";
}
async function scopedMovieParticipant(
  context: ReturnType<typeof movieManagementContext>,
  torrentId: string,
) {
  const { budget } = context.movieManagement;
  const scoped = await context.db.acquisitionAttempt.findFirst({
    where: {
      torrentId,
      AND: [
        { identityEvidence: { path: ["canonical", "kind"], equals: "movie" } },
      ],
      OR: [
        { identityEvidence: { path: ["schemaVersion"], equals: 2 } },
        { identityEvidence: { path: ["schemaVersion"], equals: 3 } },
      ],
    },
  });
  budget.consume(scoped === null ? 0 : 1);
  if (scoped === null) {
    const granted = await context.db.operation.findFirst({
      where: {
        result: {
          path: ["movieTransferReuseGrantV1", "grant", "transfer", "id"],
          equals: torrentId,
        },
      },
    });
    if (granted === null) return false;
    budget.consume(1);
  }
  return true;
}

/** Internal scoped branch only. One execution/budget covers discovery, evaluation and final removal. */
export async function scopedMovieSeeding(
  initial: MediaAutomationContext,
  torrentId: string,
  phase: "evaluation" | "removal",
) {
  const context = movieManagementContext(initial);
  const { budget, execution } = context.movieManagement;
  execution.assertActive();
  if (!(await scopedMovieParticipant(context, torrentId))) return null;
  const torrent = await movieSourceCohort(context.db, torrentId, budget);
  let snapshot: CleanupSnapshot = torrent;
  const runtime = await requireActiveRuntime(context.db);
  const record = async (
    reason: Reason | null,
    status: "protected" | "removed" | "seeding" | "removable" = "protected",
  ) =>
    recordOutcome(
      context.db,
      snapshot,
      { phase, evaluatedAt: new Date(), recoveryEpoch: runtime.epoch },
      { status, reason },
    );
  if (torrent.state === "removed") return record(null, "removed");
  if (torrent.state === "removing") return record("removal_outcome_unknown");
  if (
    !runtime.active ||
    runtime.epoch !== torrent.ownershipEpoch ||
    !(await context.gates.sourceCleanup())
  )
    return record("source_cleanup_disabled");
  await context.qbittorrent.login(execution.signal);
  execution.assertActive();
  const observed = await context.qbittorrent.observe(
    torrent.infoHash,
    execution.signal,
  );
  execution.assertActive();
  if (observed === null) return record("torrent_missing");
  if (!hasApplicationSeedingPolicy(observed))
    return record("torrent_policy_drift");
  const dependencies = await movieSourceDependencies(
    context.db,
    context,
    torrent,
    { observed, budget },
  );
  if (dependencies === null) return record("source_dependencies_changed");
  const stored = await observeMovieSourceForSeeding(context, {
    torrent,
    scope: dependencies.scope,
    observation: observed,
  });
  if (stored === null) return record("source_dependencies_changed");
  snapshot = {
    ...torrent,
    observation: stored.observation,
    observedAt: stored.observedAt,
  };
  const evaluated = evaluateSeeding(PolicySchema.parse(torrent.seedingPolicy), {
    ratio:
      observed.ratio.kind === "finite" ? observed.ratio.value : observed.ratio,
    seedingSeconds: observed.seeding_time,
    sizeBytes: observed.size,
    complete: observed.progress === 1,
    owned: torrent.owned,
    dependenciesRemaining: dependencies.dependenciesRemaining,
  });
  if (phase === "evaluation" || !evaluated.eligible)
    return record(
      CleanupReasonSchema.parse(evaluated.reason),
      evaluationStatus(evaluated),
    );
  const claim = await context.db.torrent.updateMany({
    where: { id: torrentId, state: { notIn: ["removing", "removed"] } },
    data: { state: "removing" },
  });
  if (claim.count !== 1) return record("removal_outcome_unknown");
  const mutation = { started: false };
  try {
    return await context.db.$transaction(
      async (tx) => {
        await lockMovieCommand(tx, dependencies.scope);
        await assertNoPublicationCompensationFence(tx, {
          mediaIds: [dependencies.scope.mediaId],
          assetIds: torrent.assets.map((a) => a.id),
        });
        const authorized = await lockRuntimeAuthority(
          tx,
          torrent.ownershipEpoch,
        );
        await lockMovieSourceParticipants(tx, torrent);
        const current = await movieSourceCohort(tx, torrentId, budget);
        const protect = async (reason: Reason) => {
          await tx.torrent.updateMany({
            where: { id: torrentId, state: "removing" },
            data: { state: torrent.state },
          });
          return recordOutcome(
            tx,
            current,
            { phase, evaluatedAt: new Date(), recoveryEpoch: runtime.epoch },
            { status: "protected", reason },
          );
        };
        if (
          !authorized ||
          !(await context.gates.sourceCleanup()) ||
          !sameRemovalCohort(current, torrent, runtime.epoch)
        )
          return protect("source_dependencies_changed");
        const live = await context.qbittorrent.observe(
          current.infoHash,
          execution.signal,
        );
        execution.assertActive();
        if (live === null) return protect("torrent_missing");
        const currentDependencies = await movieSourceDependencies(
          tx,
          context,
          current,
          { observed: live, budget },
        );
        if (
          currentDependencies?.owner.id !== dependencies.owner.id ||
          currentDependencies.dependenciesRemaining
        )
          return protect("source_dependencies_changed");
        const isolated = path.join(
          context.downloadRoot,
          "media",
          currentDependencies.owner.id,
        );
        if (
          path.resolve(live.save_path) !== isolated ||
          !path.resolve(live.content_path).startsWith(`${isolated}/`)
        )
          return protect("source_ownership_unproven");
        if (!hasApplicationSeedingPolicy(live))
          return protect("torrent_policy_drift");
        if (!(await sourceDirectoryExclusive(context, live.hash, isolated)))
          return protect("source_directory_shared");
        execution.assertActive();
        const final = evaluateSeeding(
          PolicySchema.parse(current.seedingPolicy),
          {
            ratio: live.ratio.kind === "finite" ? live.ratio.value : live.ratio,
            seedingSeconds: live.seeding_time,
            sizeBytes: live.size,
            complete: live.progress === 1,
            owned: current.owned,
            dependenciesRemaining: false,
          },
        );
        if (!final.eligible)
          return protect(CleanupReasonSchema.parse(final.reason));
        const writer = await tx.legacyWriterLease.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        budget.consume(1);
        if (
          writer.revokedAt !== null ||
          writer.recoveryEpoch !== runtime.epoch ||
          writer.observedAt.getTime() > Date.now()
        )
          return protect("source_cleanup_disabled");
        const freshness = plexBindingFreshness({
          observed: execution.observed,
          expiresAtMs: Math.min(
            execution.expiresAtMs,
            writer.expiresAt.getTime(),
          ),
          guards: [execution],
        });
        await bindPlexTransactionDeadline(tx, freshness);
        await context.qbittorrent.remove(
          {
            hash: current.infoHash,
            operationId: currentDependencies.owner.operationId,
            attemptId: currentDependencies.owner.id,
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
          where: { id: torrentId },
          data: { state: "removed" },
        });
        return recordOutcome(
          tx,
          current,
          { phase, evaluatedAt: new Date(), recoveryEpoch: runtime.epoch },
          { status: "removed", reason: null },
        );
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    if (!mutation.started)
      await context.db.torrent.updateMany({
        where: { id: torrentId, state: "removing" },
        data: { state: torrent.state },
      });
    throw error;
  }
}
