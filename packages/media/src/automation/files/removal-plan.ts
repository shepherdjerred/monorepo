import nodePath from "node:path";
import { ownedSubtitleSidecars } from "./subtitle-lifecycle/ownership.ts";
import { z } from "zod";
import {
  FileGuardError,
  RemovalPlanSchema,
  type FileContext,
  type Transaction,
  type RemovalEntry,
} from "./types.ts";

export function libraryLocation(
  context: FileContext,
  path: string,
): { libraryKind: "movies" | "tv"; libraryPath: string } {
  for (const libraryKind of ["movies", "tv"] as const) {
    const relative = nodePath.relative(
      context.roots[libraryKind].library,
      path,
    );
    if (
      relative !== ".." &&
      relative.length > 0 &&
      !relative.startsWith(`..${nodePath.sep}`) &&
      !nodePath.isAbsolute(relative)
    )
      return { libraryKind, libraryPath: relative };
  }
  throw new FileGuardError("asset_outside_library");
}

export async function removalPlan(
  tx: Transaction,
  context: FileContext,
  decisionId: string,
): Promise<RemovalEntry[]> {
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  if (decision.manifest !== null)
    return RemovalPlanSchema.parse(decision.manifest).assets;
  const override = z
    .object({
      ownerOverride: z.object({
        assets: z.array(z.object({ id: z.string() })),
      }),
    })
    .safeParse(decision.evidence);
  const scope = override.success
    ? {
        assetId: {
          in: override.data.ownerOverride.assets.map((asset) => asset.id),
        },
      }
    : { mediaId: decision.mediaId };
  const coverage = await tx.assetCoverage.findMany({
    where: { ...scope, current: true },
    distinct: ["assetId"],
    include: {
      asset: {
        include: {
          coverage: {
            where: { current: true },
            include: { media: { include: { intent: true } } },
          },
          subtitles: { where: { state: "installed" } },
        },
      },
    },
  });
  const assets: RemovalEntry[] = [];
  for (const { asset } of coverage) {
    if (!asset.owned || asset.checksum === null || asset.state !== "published")
      throw new FileGuardError("asset_not_owned");
    const location = libraryLocation(context, asset.path);
    const generations: Record<string, number> = {};
    for (const item of asset.coverage) {
      if (item.media.intent === null)
        throw new FileGuardError("intent_missing");
      generations[item.mediaId] = item.media.intent.generation;
    }
    const sidecars = planSidecars(
      context,
      location.libraryKind,
      ownedSubtitleSidecars(asset),
    );
    assets.push({
      assetId: asset.id,
      assetVersion: asset.version,
      ...location,
      checksum: asset.checksum,
      quarantineId: crypto.randomUUID(),
      mediaIds: asset.coverage.map((item) => item.mediaId),
      generations,
      sidecars,
    });
  }
  if (assets.length === 0) throw new FileGuardError("asset_missing");
  await tx.retentionDecision.update({
    where: { id: decisionId },
    data: { manifest: { assets } },
  });
  return assets;
}

function planSidecars(
  context: FileContext,
  libraryKind: string,
  subtitles: readonly {
    id: string;
    path: string | null;
    checksum: string | null;
  }[],
): RemovalEntry["sidecars"] {
  const sidecars: RemovalEntry["sidecars"] = [];
  for (const subtitle of subtitles) {
    if (subtitle.path === null)
      throw new FileGuardError("subtitle_path_missing");
    const checksum = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(subtitle.checksum);
    const sidecar = libraryLocation(context, subtitle.path);
    if (sidecar.libraryKind !== libraryKind)
      throw new FileGuardError("subtitle_location_conflict");
    sidecars.push({
      subtitleId: subtitle.id,
      libraryPath: sidecar.libraryPath,
      checksum,
      quarantineId: crypto.randomUUID(),
    });
  }
  return sidecars;
}

export async function assertOwnedAsset(
  tx: Transaction,
  entry: RemovalEntry,
  state: "published" | "quarantined",
): Promise<void> {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: entry.assetId },
    include: {
      coverage: { where: { current: true } },
      subtitles: { where: { state: { in: ["installed", "quarantined"] } } },
    },
  });
  const version = entry.assetVersion + (state === "quarantined" ? 1 : 0);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    !asset.owned ||
    asset.ownershipEpoch !== runtime.recoveryEpoch ||
    asset.checksum !== entry.checksum ||
    asset.version !== version ||
    asset.state !== state ||
    asset.coverage.length !== entry.mediaIds.length ||
    asset.coverage.some((item) => !entry.mediaIds.includes(item.mediaId))
  )
    throw new FileGuardError("asset_version_changed");
  const subtitles = ownedSubtitleSidecars(asset);
  if (
    subtitles.length !== entry.sidecars.length ||
    entry.sidecars.some(
      (sidecar) =>
        !subtitles.some(
          (subtitle) =>
            subtitle.id === sidecar.subtitleId &&
            subtitle.checksum === sidecar.checksum,
        ),
    )
  )
    throw new FileGuardError("subtitle_manifest_changed");
}
