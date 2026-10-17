import { z } from "zod";
import { evaluateSeeding } from "#domain/seeding.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import { requireActiveRuntime } from "./runtime.ts";
import path from "node:path";
import { lockMedia } from "#infrastructure/locks.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";

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
  id: string,
  previousState: string,
  reason: string,
): ReturnType<SeedingActivities["removeMediaTorrent"]> {
  await tx.torrent.updateMany({
    where: { id, state: "removing" },
    data: { state: previousState },
  });
  return { status: "protected", reason };
}

async function evaluate(
  context: MediaAutomationContext,
  torrentId: string,
): ReturnType<SeedingActivities["evaluateMediaSeeding"]> {
  const torrent = await context.db.torrent.findUniqueOrThrow({
    where: { id: torrentId },
    include: { attempts: true, assets: true },
  });
  if (torrent.state === "removed") return { status: "removed", reason: null };
  const runtime = await requireActiveRuntime(context.db);
  if (
    !runtime.active ||
    torrent.ownershipEpoch !== runtime.epoch ||
    !(await context.gates.sourceCleanup()) ||
    torrent.attempts.some((attempt) => attempt.recoveryEpoch !== runtime.epoch)
  )
    return { status: "protected", reason: "source_cleanup_disabled" };
  await context.qbittorrent.login();
  const observed = await context.qbittorrent.observe(torrent.infoHash);
  if (observed === null)
    return { status: "protected", reason: "torrent_missing" };
  const files =
    observed.progress === 1
      ? await context.qbittorrent.files(observed.hash)
      : [];
  await context.db.torrent.update({
    where: { id: torrent.id },
    data: {
      qbittorrentId: observed.hash,
      observation: { torrent: observed, files },
      observedAt: new Date(),
    },
  });
  if (!hasApplicationSeedingPolicy(observed))
    return { status: "protected", reason: "torrent_policy_drift" };
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
  return {
    status: evaluation.eligible
      ? "removable"
      : evaluation.reason === "seeding_required"
        ? "seeding"
        : "protected",
    reason: evaluation.reason,
  };
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
      const submitted = torrent.attempts[0];
      if (submitted === undefined)
        return { status: "protected", reason: "submission_ownership_unknown" };
      const claim = await context.db.torrent.updateMany({
        where: { id: torrent.id, state: { notIn: ["removing", "removed"] } },
        data: { state: "removing" },
      });
      if (claim.count !== 1)
        return { status: "protected", reason: "removal_outcome_unknown" };
      const mutation = { started: false };
      try {
        return await context.db.$transaction(
          async (tx) => {
            await lockMedia(
              tx,
              torrent.attempts.flatMap((attempt) => attempt.mediaIds),
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
              include: { attempts: true },
            });
            if (
              !authorized ||
              current.ownershipEpoch !== runtime.recoveryEpoch ||
              runtime.mode !== "active" ||
              !runtime.ownershipConfirmed ||
              !(await context.gates.sourceCleanup()) ||
              current.attempts.some(
                (attempt) =>
                  attempt.recoveryEpoch !== runtime.recoveryEpoch ||
                  (attempt.state !== "completed" &&
                    attempt.state !== "cancelled"),
              )
            )
              return releaseRemovalClaim(
                tx,
                torrent.id,
                torrent.state,
                "source_dependencies_changed",
              );
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
              return releaseRemovalClaim(
                tx,
                torrent.id,
                torrent.state,
                "source_ownership_unproven",
              );
            context.qbittorrent.validateOwnership(observed, {
              operationId: submitted.operationId,
              attemptId: submitted.id,
              savePath: isolated,
            });
            if (!hasApplicationSeedingPolicy(observed))
              return releaseRemovalClaim(
                tx,
                torrent.id,
                torrent.state,
                "torrent_policy_drift",
              );
            if (
              !(await sourceDirectoryExclusive(
                context,
                observed.hash,
                isolated,
              ))
            )
              return releaseRemovalClaim(
                tx,
                torrent.id,
                torrent.state,
                "source_directory_shared",
              );
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
              return releaseRemovalClaim(
                tx,
                torrent.id,
                torrent.state,
                evaluated.reason,
              );
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
        throw error;
      }
    },
  };
}
