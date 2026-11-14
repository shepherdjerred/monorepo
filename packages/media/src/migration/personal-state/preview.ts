import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  PersonalMigrationInputSchema,
  PersonalMigrationClaim,
} from "#shared/personal-migration/contract.ts";
import { validateCapture } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { migrationTargets } from "#migration/catalog-targets.ts";
import {
  bindingIdentity,
  durableBindingIdentity,
  requesterEvidence,
  eligibleBindingTarget,
} from "#infrastructure/recovery/legacy-claims/bindings.ts";
import { personalClaims, type PersonalClaimBinding } from "./claims.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

export async function previewPersonalMigration(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof PersonalMigrationInputSchema>,
  machineId: string,
) {
  const captures = await tx.migrationCapture.findMany({
    where: { id: { in: input.captureIds } },
    orderBy: { id: "asc" },
  });
  if (captures.length !== input.captureIds.length)
    throw new Error("An exact migration capture is unavailable");
  const parsed = captures.map((row) => {
    const capture = validateCapture(row.manifest);
    if (
      row.sourceKind !== capture.snapshot.sourceKind ||
      row.sourceInstanceId !== capture.snapshot.sourceInstanceId ||
      !capture.complete ||
      !capture.stable ||
      capture.captureHash !== row.manifestHash
    )
      throw new Error("Migration requires complete stable literal captures");
    if (capture.snapshot.sourceKind === "qbittorrent")
      throw new Error("Personal migration never adopts torrent state");
    return { row, capture };
  });
  if (
    new Set(
      parsed.map(
        ({ capture }) =>
          `${capture.snapshot.sourceKind}:${capture.snapshot.sourceInstanceId}`,
      ),
    ).size !== parsed.length
  )
    throw new Error("Choose one exact final capture per source instance");
  const targets = await migrationTargets(tx);
  const existing = await tx.mediaRequest.findMany({
    orderBy: { id: "asc" },
    take: 50_001,
  });
  const intents = await tx.mediaIntent.findMany({
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
    take: 50_001,
  });
  const media = await tx.mediaItem.findMany({
    orderBy: { id: "asc" },
    select: { id: true, version: true },
    take: 50_001,
  });
  const assets = await tx.libraryAsset.findMany({
    where: { coverage: { some: { current: true } } },
    include: { coverage: true },
    orderBy: { id: "asc" },
    take: 50_001,
  });
  if ([existing, intents, media, assets].some((rows) => rows.length > 50_000))
    throw new Error("Migration exceeds bounded household inventory");
  const claims: PersonalMigrationClaim[] = [];
  const bindings: PersonalClaimBinding[] = [];
  for (const { row, capture } of parsed) {
    const scoped: PersonalClaimBinding[] = [];
    const requesterIds = [
      ...new Set(
        capture.snapshot.records.flatMap((record) =>
          record.kind === "request" ? [record.requesterSourceId] : [],
        ),
      ),
    ].sort();
    if (requesterIds.length > 100)
      throw new Error(
        "Migration exceeds bounded household requester inventory",
      );
    for (const requesterSourceId of requesterIds) {
      const binding = await tx.legacyRequesterBinding.findFirst({
        where: {
          sourceKind: row.sourceKind,
          sourceInstanceId: row.sourceInstanceId,
          requesterSourceId,
        },
        orderBy: { revision: "desc" },
        include: { user: { include: { plexIdentity: true } } },
      });
      if (binding === null) continue;
      const evidence = await requesterEvidence(tx, row.id, requesterSourceId);
      const valid =
        binding.captureId === row.id &&
        binding.captureHash === row.manifestHash &&
        binding.requesterEvidenceHash === evidence.requesterEvidenceHash &&
        binding.user.plexIdentity !== null &&
        eligibleBindingTarget(binding.user, machineId) &&
        binding.user.plexIdentity.permittedSectionIds.length > 0 &&
        snapshotHash(durableBindingIdentity(bindingIdentity(binding.user))) ===
          snapshotHash(durableBindingIdentity(binding.identitySnapshot));
      scoped.push({
        requesterSourceId,
        id: binding.id,
        revision: binding.revision,
        userId: binding.userId,
        valid,
        permittedMediaKinds:
          binding.user.plexIdentity?.permittedMediaKinds ?? [],
      });
    }
    bindings.push(...scoped);
    claims.push(
      ...personalClaims({
        captureId: row.id,
        snapshot: capture.snapshot,
        targets,
        bindings: scoped,
        movieEditions: input.movieEditions,
        existing,
        historyOnly: input.historyOnly,
      }),
    );
  }
  const library = assets.flatMap((asset) =>
    asset.coverage
      .filter((coverage) => coverage.current)
      .map((coverage) => ({
        assetId: asset.id,
        assetVersion: asset.version,
        mediaId: coverage.mediaId,
        edition: coverage.edition,
      })),
  );
  if (claims.length > 1000)
    throw new Error("Personal migration exceeds 1000 bounded source requests");
  const state = {
    runtime: await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
    media,
    intents,
    existing,
    assets: assets.map((asset) => ({
      ...asset,
      sizeBytes: asset.sizeBytes.toString(),
    })),
    bindings,
  };
  if (
    input.historyOnly.some(
      (key) => !claims.some((claim) => claim.provenanceKey === key),
    )
  )
    throw new Error(
      "History-only approval does not belong to the selected captures",
    );
  const preview = {
    schemaVersion: 1,
    captures: captures.map((row) => ({
      id: row.id,
      captureHash: row.manifestHash,
      sourceKind: row.sourceKind,
    })),
    claims,
    library,
    stateHash: snapshotHash(nativeJson(state)),
    monitoring: parsed.flatMap(({ row, capture }) =>
      capture.snapshot.records
        .filter((record) => record.kind === "media")
        .map((record) => ({ captureId: row.id, record })),
    ),
    subtitlePolicies: parsed.flatMap(({ row, capture }) =>
      capture.snapshot.records
        .filter((record) => record.kind === "subtitle_preference")
        .map((record) => ({ captureId: row.id, record })),
    ),
    blocked: claims.some((claim) => claim.disposition === "blocked"),
    libraryKeepingPolicy: "keep",
    importedClaimKeepingPolicy: "temporary",
    importedClaimInterest: "following",
    transfersTorrentOwnership: false,
    changesPlaybackState: false,
  };
  return { ...preview, previewHash: snapshotHash(z.json().parse(preview)) };
}
