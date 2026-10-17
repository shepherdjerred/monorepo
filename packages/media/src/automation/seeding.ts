import { z } from "zod";
import { evaluateSeeding } from "#domain/seeding.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import { requireActiveRuntime } from "./runtime.ts";
import path from "node:path";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  recordCleanupEvaluation,
  type CleanupSnapshot,
} from "#infrastructure/visibility/seeding.ts";
import {
  CleanupReasonSchema,
  type CleanupEvaluation,
} from "#shared/visibility/seeding.ts";

const PolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("unknown") }),
  z.object({
    kind: z.literal("privatehd"),
    verified: z.boolean(),
    ratio: z.number().nullable(),
  }),
  z.object({
    kind: z.literal("private"),
    verified: z.boolean(),
    ratio: z.number().nullable(),
    minimumSeconds: z.number().nullable(),
    combination: z.enum(["all", "any"]),
    sizeRule: z
      .object({
        secondsPerGiB: z.number(),
        minimumSeconds: z.number(),
        maximumSeconds: z.number().nullable(),
      })
      .nullable(),
  }),
]);

type SeedingActivities = Pick<
  MediaNetworkActivities,
  "evaluateMediaSeeding" | "removeMediaTorrent"
>;
type Outcome = Awaited<ReturnType<SeedingActivities["evaluateMediaSeeding"]>>;

async function recordOutcome(
  db: Pick<Prisma.TransactionClient, "torrent" | "$queryRaw">,
  snapshot: CleanupSnapshot,
  input: {
    recoveryEpoch: number;
    evaluatedAt: Date;
    phase: CleanupEvaluation["phase"];
  },
  outcome: Outcome,
): Promise<Outcome> {
  await recordCleanupEvaluation(db, snapshot, {
    ...input,
    status: outcome.status,
    reason: CleanupReasonSchema.nullable().parse(outcome.reason),
  });
  return outcome;
}

function pathsOverlap(first: string, second: string): boolean {
  const left = path.resolve(first);
  const right = path.resolve(second);
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

async function sourceDirectoryExclusive(
  context: MediaAutomationContext,
  hash: string,
  isolated: string,
): Promise<boolean> {
  const torrents = await context.qbittorrent.listAll();
  return torrents.every(
    (torrent) =>
      torrent.hash === hash ||
      (torrent.content_path.length > 0 &&
        !pathsOverlap(torrent.content_path, isolated) &&
        !path.resolve(torrent.save_path).startsWith(`${isolated}/`) &&
        path.resolve(torrent.save_path) !== isolated),
  );
}

async function releaseRemovalClaim(
  tx: Prisma.TransactionClient,
  snapshot: CleanupSnapshot,
  input: { previousState: string; reason: string; recoveryEpoch: number },
): ReturnType<SeedingActivities["removeMediaTorrent"]> {
  await tx.torrent.updateMany({
    where: { id: snapshot.id, state: "removing" },
    data: { state: input.previousState },
  });
  await recordOutcome(
    tx,
    snapshot,
    {
      recoveryEpoch: input.recoveryEpoch,
      evaluatedAt: new Date(),
      phase: "removal",
    },
    { status: "protected", reason: input.reason },
  );
  return { status: "protected", reason: input.reason };
}

async function evaluate(
  context: MediaAutomationContext,
  torrentId: string,
): ReturnType<SeedingActivities["evaluateMediaSeeding"]> {
  const evaluatedAt = new Date();
  const torrent = await context.db.torrent.findUniqueOrThrow({
    where: { id: torrentId },
    include: { attempts: true, assets: true },
  });
  const runtime = await requireActiveRuntime(context.db);
  const evaluationInput = {
    evaluatedAt,
    recoveryEpoch: runtime.epoch,
    phase: "evaluation" as const,
  };
  if (torrent.state === "removed")
    return await recordOutcome(context.db, torrent, evaluationInput, {
      status: "removed",
      reason: null,
    });
  // Source ownership is global: never hide another edition's participant.
  if (
    torrent.attempts.some((attempt) => attempt.edition !== "default") ||
    torrent.assets.some((asset) => asset.edition !== "default")
  )
    return await recordOutcome(context.db, torrent, evaluationInput, {
      status: "protected",
      reason: "source_dependencies_changed",
    });
  if (
    !runtime.active ||
    torrent.ownershipEpoch !== runtime.epoch ||
    !(await context.gates.sourceCleanup()) ||
    torrent.attempts.some((attempt) => attempt.recoveryEpoch !== runtime.epoch)
  )
    return await recordOutcome(context.db, torrent, evaluationInput, {
      status: "protected",
      reason: "source_cleanup_disabled",
    });
  await context.qbittorrent.login();
  const observed = await context.qbittorrent.observe(torrent.infoHash);
  if (observed === null)
    return await recordOutcome(context.db, torrent, evaluationInput, {
      status: "protected",
      reason: "torrent_missing",
    });
  const files =
    observed.progress === 1
      ? await context.qbittorrent.files(observed.hash)
      : [];
  const stored = await context.db.torrent.update({
    where: { id: torrent.id },
    data: {
      qbittorrentId: observed.hash,
      observation: { torrent: observed, files },
      observedAt: new Date(),
    },
  });
  // Bind diagnostics to the observation actually persisted, but retain the
  // original policy/epoch that this evaluation used. A concurrent change fails CAS.
  const snapshot = {
    ...torrent,
    observation: stored.observation,
    observedAt: stored.observedAt,
  };
  if (!hasApplicationSeedingPolicy(observed))
    return await recordOutcome(context.db, snapshot, evaluationInput, {
      status: "protected",
      reason: "torrent_policy_drift",
    });
  const dependenciesRemaining =
    torrent.attempts.some(
      (attempt) =>
        attempt.state !== "completed" && attempt.state !== "cancelled",
    ) ||
    torrent.assets.some(
      (asset) =>
        asset.state !== "published" &&
        asset.state !== "superseded" &&
        asset.state !== "quarantined" &&
        asset.state !== "purged",
    );
  const evaluation = evaluateSeeding(
    PolicySchema.parse(torrent.seedingPolicy),
    {
      ratio:
        observed.ratio.kind === "finite"
          ? observed.ratio.value
          : observed.ratio,
      seedingSeconds: observed.seeding_time,
      sizeBytes: observed.size,
      complete: observed.progress === 1,
      owned: torrent.owned,
      dependenciesRemaining,
    },
  );
  return await recordOutcome(context.db, snapshot, evaluationInput, {
    status: evaluation.eligible
      ? "removable"
      : evaluation.reason === "seeding_required"
        ? "seeding"
        : "protected",
    reason: evaluation.reason,
  });
}

export function createSeedingActivities(
  context: MediaAutomationContext,
): SeedingActivities {
  return {
    evaluateMediaSeeding: (input) => evaluate(context, input.torrentId),
    async removeMediaTorrent(input) {
      const outcome = await evaluate(context, input.torrentId);
      if (outcome.status === "removed")
        return { status: "removed", reason: null };
      if (outcome.status !== "removable")
        return { status: "protected", reason: outcome.reason };
      const torrent = await context.db.torrent.findUniqueOrThrow({
        where: { id: input.torrentId },
        include: { attempts: { orderBy: { createdAt: "asc" } } },
      });
      const runtimeSnapshot =
        await context.db.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
      const removalInput = {
        evaluatedAt: new Date(),
        recoveryEpoch: runtimeSnapshot.recoveryEpoch,
        phase: "removal" as const,
      };
      const submitted = torrent.attempts[0];
      if (submitted === undefined) {
        await recordOutcome(context.db, torrent, removalInput, {
          status: "protected",
          reason: "submission_ownership_unknown",
        });
        return { status: "protected", reason: "submission_ownership_unknown" };
      }
      const claim = await context.db.torrent.updateMany({
        where: { id: torrent.id, state: { notIn: ["removing", "removed"] } },
        data: { state: "removing" },
      });
      if (claim.count !== 1) {
        await recordOutcome(context.db, torrent, removalInput, {
          status: "protected",
          reason: "removal_outcome_unknown",
        });
        return { status: "protected", reason: "removal_outcome_unknown" };
      }
      const mutation = { started: false };
      try {
        return await context.db.$transaction(
          async (tx) => {
            await lockDefaultScopes(
              tx,
              torrent.attempts
                .flatMap((attempt) => attempt.mediaIds)
                .map((id) => defaultScope(id)),
              { createMissing: false },
            );
            const authorized = await lockRuntimeAuthority(
              tx,
              torrent.ownershipEpoch,
            );
            await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id = ${torrent.id} FOR UPDATE`;
            const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
              where: { id: "singleton" },
            });
            const current = await tx.torrent.findUniqueOrThrow({
              where: { id: torrent.id },
              include: { attempts: true, assets: true },
            });
            if (
              !authorized ||
              current.ownershipEpoch !== runtime.recoveryEpoch ||
              runtime.mode !== "active" ||
              !runtime.ownershipConfirmed ||
              !(await context.gates.sourceCleanup()) ||
              current.assets.some((asset) => asset.edition !== "default") ||
              current.attempts.some(
                (attempt) =>
                  attempt.edition !== "default" ||
                  attempt.recoveryEpoch !== runtime.recoveryEpoch ||
                  (attempt.state !== "completed" &&
                    attempt.state !== "cancelled"),
              )
            )
              return releaseRemovalClaim(tx, current, {
                previousState: torrent.state,
                reason: "source_dependencies_changed",
                recoveryEpoch: runtime.recoveryEpoch,
              });
            const observed = await context.qbittorrent.observe(
              torrent.infoHash,
            );
            const isolated = path.join(
              context.downloadRoot,
              "media",
              submitted.id,
            );
            if (
              observed === null ||
              path.resolve(observed.save_path) !== isolated ||
              !observed.content_path.startsWith(`${isolated}/`)
            )
              return releaseRemovalClaim(tx, current, {
                previousState: torrent.state,
                reason: "source_ownership_unproven",
                recoveryEpoch: runtime.recoveryEpoch,
              });
            context.qbittorrent.validateOwnership(observed, {
              operationId: submitted.operationId,
              attemptId: submitted.id,
              savePath: isolated,
            });
            if (!hasApplicationSeedingPolicy(observed))
              return releaseRemovalClaim(tx, current, {
                previousState: torrent.state,
                reason: "torrent_policy_drift",
                recoveryEpoch: runtime.recoveryEpoch,
              });
            if (
              !(await sourceDirectoryExclusive(
                context,
                observed.hash,
                isolated,
              ))
            )
              return releaseRemovalClaim(tx, current, {
                previousState: torrent.state,
                reason: "source_directory_shared",
                recoveryEpoch: runtime.recoveryEpoch,
              });
            const evaluated = evaluateSeeding(
              PolicySchema.parse(current.seedingPolicy),
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
            if (!evaluated.eligible)
              return releaseRemovalClaim(tx, current, {
                previousState: torrent.state,
                reason: evaluated.reason,
                recoveryEpoch: runtime.recoveryEpoch,
              });
            mutation.started = true;
            await context.qbittorrent.remove({
              hash: torrent.infoHash,
              operationId: submitted.operationId,
              attemptId: submitted.id,
              savePath: isolated,
              deleteFiles: true,
            });
            await tx.torrent.update({
              where: { id: torrent.id },
              data: { state: "removed" },
            });
            await recordOutcome(
              tx,
              current,
              {
                evaluatedAt: new Date(),
                recoveryEpoch: runtime.recoveryEpoch,
                phase: "removal",
              },
              { status: "removed", reason: null },
            );
            return { status: "removed", reason: null };
          },
          { timeout: 60_000 },
        );
      } catch (error) {
        if (!mutation.started)
          await context.db.torrent.updateMany({
            where: { id: torrent.id, state: "removing" },
            data: { state: torrent.state },
          });
        if (mutation.started) {
          // Do not reset the unresolved removal claim or retry its external
          // mutation because recording an informational diagnostic failed.
          try {
            await recordOutcome(
              context.db,
              torrent,
              { ...removalInput, evaluatedAt: new Date() },
              {
                status: "protected",
                reason: "removal_outcome_unknown",
              },
            );
          } catch {
            // The original uncertain-effect failure must remain observable.
          }
        }
        throw error;
      }
    },
  };
}
