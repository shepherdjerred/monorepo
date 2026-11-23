import {
  ReplayPatchObservationSchema,
  ReplayRenderPackageAdmissionSchema,
  ReplayRenderPackageManifestSchema,
  type ReplayPatchObservation,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { normalizeGameBuild } from "@scout-for-lol/domain/artifacts/replay-transport.mjs";
import type { PublicReplayPlayback } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { prisma } from "#src/database/index.ts";
import type { PublicReplayIdentity } from "./catalog.ts";

/** Discovery runs every five minutes; stale observations cannot keep old patches active. */
export const REPLAY_PATCH_OBSERVATION_MAX_AGE_MS = 30 * 60 * 1000;

export type StoredReplayRenderPackage = {
  readonly manifestSha256: string;
  readonly gameBuild: string;
  readonly protocol: string;
  readonly manifestPath: string;
  readonly manifestJson: string;
  readonly publishedSha256: string;
  readonly publishedAt: Date;
  readonly admissionJson: unknown;
  readonly admittedAt: Date;
};
export type ReplaySupportDependencies = {
  readonly observation: (
    platformId: string,
  ) => Promise<ReplayPatchObservation | null>;
  readonly renderPackage: (
    gameBuild: string,
    protocol: string,
  ) => Promise<StoredReplayRenderPackage | null>;
  readonly now: () => Date;
};

const dependencies: ReplaySupportDependencies = {
  async observation(platformId) {
    const row = await prisma.replayPatchObservation.findUnique({
      where: { platformId },
    });
    return row === null
      ? null
      : { ...row, observedAt: row.observedAt.toISOString() };
  },
  async renderPackage(gameBuild, protocol) {
    return await prisma.replayRenderPackage.findUnique({
      where: { gameBuild_protocol: { gameBuild, protocol } },
    });
  },
  now: () => new Date(),
};

function patchOf(build: string): string {
  const normalized = normalizeGameBuild(build);
  if (normalized === null)
    throw new Error("Replay registry has an invalid native build");
  return normalized.split(".").slice(0, 2).join(".");
}

function olderPatch(left: string, right: string): boolean {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return (
    (a[0] ?? 0) < (b[0] ?? 0) || (a[0] === b[0] && (a[1] ?? 0) < (b[1] ?? 0))
  );
}

/** Verify immutable bytes and evidence receipts before exposing an available package. */
export function verifyReplayRenderPackage(
  row: StoredReplayRenderPackage,
  gameBuild: string,
  protocol: string,
  now: Date,
): { url: string; sha256: string } {
  const digest = new Bun.CryptoHasher("sha256")
    .update(row.manifestJson)
    .digest("hex");
  const manifest = ReplayRenderPackageManifestSchema.parse(
    JSON.parse(row.manifestJson),
  );
  const admission = ReplayRenderPackageAdmissionSchema.parse(row.admissionJson);
  const expectedPath = `/replay-assets/${gameBuild}/${digest}/manifest.json`;
  if (
    digest !== row.manifestSha256 ||
    digest !== row.publishedSha256 ||
    digest !== admission.manifestSha256 ||
    row.manifestPath !== expectedPath ||
    row.gameBuild !== gameBuild ||
    row.protocol !== protocol ||
    manifest.gameBuild !== gameBuild ||
    manifest.protocol !== protocol ||
    admission.nativeComparison.gameBuild !== gameBuild ||
    admission.rosterInventorySha256 !==
      manifest.capabilities.rosterInventorySha256 ||
    admission.nativeComparison.reportPath !==
      `/replay-evidence/${admission.nativeComparison.reportSha256}/report.json` ||
    !Number.isFinite(row.publishedAt.getTime()) ||
    !Number.isFinite(row.admittedAt.getTime()) ||
    row.publishedAt > row.admittedAt ||
    row.admittedAt > now
  )
    throw new Error(
      "Replay package publication or native admission does not match its immutable manifest",
    );
  return { url: row.manifestPath, sha256: digest };
}

function presentationFailure(
  replay: PublicReplayIdentity,
  latestPatch: string,
): PublicReplayPlayback | null {
  if (
    replay.mapId === null ||
    replay.gameMode === null ||
    replay.teamSizes === null
  )
    return { status: "metadata_pending" };
  if (replay.mapId !== 11)
    return { status: "incompatible", latestPatch, reason: "unsupported_map" };
  if (replay.gameMode !== "CLASSIC")
    return { status: "incompatible", latestPatch, reason: "unsupported_mode" };
  if (
    replay.teamSizes.length !== 2 ||
    replay.teamSizes.some((size) => size !== 5)
  )
    return {
      status: "incompatible",
      latestPatch,
      reason: "unsupported_roster",
    };
  return null;
}

/** Latest means the fresh official native release for this replay's platform. */
export async function resolveReplaySupport(
  replay: PublicReplayIdentity,
  deps: ReplaySupportDependencies = dependencies,
): Promise<PublicReplayPlayback> {
  if (replay.platformId === null)
    return {
      status: "incompatible",
      latestPatch: null,
      reason: "unqualified_platform",
    };
  if (
    replay.gameBuild === null ||
    replay.protocol === null ||
    replay.durationSeconds === null
  )
    return { status: "metadata_pending" };
  const raw = await deps.observation(replay.platformId);
  if (raw === null)
    return {
      status: "support_preparing",
      latestPatch: null,
      reason: "patch_unobserved",
    };
  const observation = ReplayPatchObservationSchema.parse(raw);
  const now = deps.now();
  const observedAt = new Date(observation.observedAt);
  if (
    observation.platformId !== replay.platformId ||
    observedAt.getTime() > now.getTime() + 60_000
  )
    throw new Error(
      "Replay patch observation contradicts its platform, native build or clock",
    );
  if (
    now.getTime() - observedAt.getTime() >=
    REPLAY_PATCH_OBSERVATION_MAX_AGE_MS
  )
    return {
      status: "support_preparing",
      latestPatch: null,
      reason: "patch_unobserved",
    };
  const latestPatch = observation.patch;
  const replayBuild = normalizeGameBuild(replay.gameBuild);
  if (replayBuild === null)
    throw new Error("Validated replay has an invalid native build");
  if (olderPatch(patchOf(replayBuild), latestPatch))
    return { status: "incompatible", latestPatch, reason: "older_patch" };
  if (replayBuild !== observation.gameBuild)
    return { status: "incompatible", latestPatch, reason: "unsupported_build" };
  const failure = presentationFailure(replay, latestPatch);
  if (failure !== null) return failure;
  const renderPackage = await deps.renderPackage(replayBuild, replay.protocol);
  if (renderPackage === null)
    return {
      status: "support_preparing",
      latestPatch,
      reason: "render_package_unavailable",
    };
  return {
    status: "available",
    latestPatch,
    package: verifyReplayRenderPackage(
      renderPackage,
      replayBuild,
      replay.protocol,
      now,
    ),
  };
}
