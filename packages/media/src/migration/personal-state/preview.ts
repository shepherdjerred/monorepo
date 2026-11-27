import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  seerrRequestReferenceKey,
  type PersonalMigrationInputSchema,
  type PersonalMigrationClaim,
} from "#shared/personal-migration/contract.ts";
import { MediaError } from "#application/errors.ts";
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

function reviewedSeerrClaims(
  claims: PersonalMigrationClaim[],
  input: z.infer<typeof PersonalMigrationInputSchema>,
) {
  const selection = input.selectedSeerrRequests;
  const keys = new Set(
    selection?.map((reference) => seerrRequestReferenceKey(reference)),
  );
  const reviewed =
    selection === undefined
      ? claims
      : claims.filter((claim) => keys.has(seerrRequestReferenceKey(claim)));
  if (selection !== undefined && reviewed.length !== keys.size)
    throw new MediaError(
      "invalid_input",
      "An exact Seerr request is unavailable in the selected captures",
      400,
    );
  if (
    input.recordHistoryOnly &&
    (selection === undefined ||
      input.movieEditions.length > 0 ||
      reviewed.some(({ reason }) => reason !== "owner_reviewed_history_only"))
  )
    throw new MediaError(
      "invalid_input",
      "History recording requires an exact history-only selection and no edition assignments",
      400,
    );
  if (
    input.historyOnly.some(
      (key) => !reviewed.some((claim) => claim.provenanceKey === key),
    )
  ) {
    if (selection === undefined)
      throw new Error(
        "History-only approval does not belong to the selected captures",
      );
    throw new MediaError(
      "invalid_input",
      "History-only approval does not belong to the selected Seerr requests",
      400,
    );
  }
  if (selection === undefined) return { claims };
  return {
    claims: reviewed,
    selectedSeerrRequests: reviewed.map(({ captureId, provenanceKey }) => ({
      captureId,
      provenanceKey,
    })),
  };
}

async function captureBindings(
  tx: Prisma.TransactionClient,
  capture: {
    id: string;
    sourceKind: string;
    sourceInstanceId: string;
    manifestHash: string;
  },
  requesterIds: readonly string[],
  options: { machineId: string; includePlexAccountId: boolean },
) {
  const scoped: PersonalClaimBinding[] = [];
  for (const requesterSourceId of requesterIds) {
    const binding = await tx.legacyRequesterBinding.findFirst({
      where: {
        sourceKind: capture.sourceKind,
        sourceInstanceId: capture.sourceInstanceId,
        requesterSourceId,
      },
      orderBy: { revision: "desc" },
      include: { user: { include: { plexIdentity: true } } },
    });
    if (binding === null) continue;
    const evidence = await requesterEvidence(tx, capture.id, requesterSourceId);
    const valid =
      binding.captureId === capture.id &&
      binding.captureHash === capture.manifestHash &&
      binding.requesterEvidenceHash === evidence.requesterEvidenceHash &&
      binding.user.plexIdentity !== null &&
      eligibleBindingTarget(binding.user, options.machineId) &&
      binding.user.plexIdentity.permittedSectionIds.length > 0 &&
      snapshotHash(durableBindingIdentity(bindingIdentity(binding.user))) ===
        snapshotHash(durableBindingIdentity(binding.identitySnapshot));
    scoped.push({
      requesterSourceId,
      id: binding.id,
      revision: binding.revision,
      userId: binding.userId,
      valid,
      permittedMediaKinds: binding.user.plexIdentity?.permittedMediaKinds ?? [],
      ...(options.includePlexAccountId
        ? { plexAccountId: binding.user.plexAccountId }
        : {}),
    });
  }
  return scoped;
}

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
    const scoped = await captureBindings(tx, row, requesterIds, {
      machineId,
      includePlexAccountId: input.deferUnboundRequesters === true,
    });
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
        deferUnboundRequesters: input.deferUnboundRequesters,
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
  const review = reviewedSeerrClaims(claims, input);
  // Another review can withdraw a parked request without changing native state.
  const approvals = await tx.seerrRequestApproval.findMany({
    where: {
      provenanceKey: { in: review.claims.map((claim) => claim.provenanceKey) },
    },
    orderBy: { provenanceKey: "asc" },
  });
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
    ...(approvals.length > 0 ? { approvals } : {}),
  };
  const preview = {
    schemaVersion: 1,
    captures: captures.map((row) => ({
      id: row.id,
      captureHash: row.manifestHash,
      sourceKind: row.sourceKind,
    })),
    ...review,
    library: input.recordHistoryOnly ? [] : library,
    ...(input.recordHistoryOnly ? { recordHistoryOnly: true } : {}),
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
    blocked: review.claims.some((claim) => claim.disposition === "blocked"),
    libraryKeepingPolicy: "keep",
    importedClaimKeepingPolicy: "temporary",
    importedClaimInterest: "following",
    transfersTorrentOwnership: false,
    changesPlaybackState: false,
  };
  return { ...preview, previewHash: snapshotHash(z.json().parse(preview)) };
}
