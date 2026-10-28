import { defaultIntent } from "#shared/editions/scope.ts";
import nodePath from "node:path";
import { workerFilePath } from "./paths/locations.ts";
import { ownedSubtitleSidecars } from "./subtitle-lifecycle/ownership.ts";
import { z } from "zod";
import { assertCleanupPhysicalAsset } from "#infrastructure/movie-editions/cleanup/authority.ts";
import {
  assertMovieRemovalDecision,
  type MovieRemovalScope,
} from "./movie-editions/removal-scope.ts";
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
      workerFilePath(context, path),
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
  movie?: MovieRemovalScope,
): Promise<RemovalEntry[]> {
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  if (movie !== undefined) {
    movie.budget.consume(1);
    assertMovieRemovalDecision(decision, movie.scope);
  }
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
    where: {
      ...scope,
      edition: movie?.scope.edition ?? "default",
      current: true,
    },
    distinct: ["assetId"],
    include: {
      asset: {
        include: {
          coverage: {
            where: { current: true },
            include: {
              media: {
                include: {
                  intents: {
                    where: { edition: movie?.scope.edition ?? "default" },
                  },
                },
              },
            },
          },
          subtitles: { where: { state: "installed" } },
        },
      },
    },
  });
  const assets: RemovalEntry[] = [];
  for (const { asset } of coverage) {
    await assertCleanupPhysicalAsset(tx, asset.id, movie?.scope);
    if (!asset.owned || asset.checksum === null || asset.state !== "published")
      throw new FileGuardError("asset_not_owned");
    const location = libraryLocation(context, asset.path);
    const generations: Record<string, number> = {};
    for (const item of asset.coverage) {
      const intent = removalIntent(item.media.intents, movie);
      if (intent == null) throw new FileGuardError("intent_missing");
      generations[item.mediaId] = intent.generation;
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
  movie?: MovieRemovalScope,
): Promise<void> {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: entry.assetId },
    include: {
      coverage: { where: { current: true } },
      subtitles: { where: { state: { in: ["installed", "quarantined"] } } },
    },
  });
  const version = entry.assetVersion + (state === "quarantined" ? 1 : 0);
  await assertCleanupPhysicalAsset(tx, asset.id, movie?.scope);
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

function removalIntent<T extends { edition: string }>(
  intents: readonly T[],
  movie?: MovieRemovalScope,
) {
  return movie === undefined
    ? defaultIntent(intents)
    : intents.find((target) => target.edition === movie.scope.edition);
}
