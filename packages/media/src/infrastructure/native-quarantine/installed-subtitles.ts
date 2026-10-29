import path from "node:path";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeSubtitleSnapshot } from "#shared/native-subtitles.ts";
import type { NativeTerminalDescriptor } from "#shared/native-recovery/terminal.ts";
import type { terminalRebindingChain } from "#infrastructure/native-recovery/terminal-rebinding.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { installedMovieSubtitleOperationV4 } from "#infrastructure/movie-editions/subtitle-installation.ts";

type Chain = Awaited<ReturnType<typeof terminalRebindingChain>>;
const Evidence = z.object({
  assetVersion: z.int().nonnegative(),
  assetChecksum: z.string(),
  exactMediaMatch: z.literal(true),
  videoVersionMatch: z.literal(true),
  recoveryEpoch: z.int().nonnegative(),
  generations: z.record(z.string(), z.int().nonnegative()),
});

/** Additional captions need their own exact app installation, not membership inferred from a path. */
export async function settledInstalledSubtitle(
  tx: Prisma.TransactionClient,
  input: {
    subtitle: NativeSubtitleSnapshot;
    chain: Chain;
    video: {
      path: string;
      checksum: string;
      mediaIds: string[];
      libraryKind: "movies" | "tv";
    };
    videoBindings: { version: number; epoch: number }[];
    movieScope?: MovieEditionScope;
  },
  budget?: PublicationAuthorityReadBudget,
) {
  const original = installationSnapshot(input.subtitle, input.chain);
  const evidence = Evidence.parse(original.matchingEvidence);
  const provenance = z
    .object({
      format: z.enum(["srt", "ass", "ssa", "vtt"]),
      checksum: z.string(),
    })
    .parse(original.provenance);
  if (
    original.storageKind !== "sidecar" ||
    original.version !== 1 ||
    original.qualityStatus !== "accepted" ||
    original.checksum === null ||
    original.checksum !== original.contentChecksum ||
    original.checksum !== provenance.checksum ||
    original.videoChecksum !== input.video.checksum ||
    original.videoChecksum !== evidence.assetChecksum ||
    original.videoVersion !== evidence.assetVersion ||
    original.ownershipEpoch !== evidence.recoveryEpoch ||
    !input.videoBindings.some(
      (item) =>
        item.version === original.videoVersion &&
        item.epoch === original.ownershipEpoch,
    ) ||
    snapshotHash(Object.keys(evidence.generations).sort()) !==
      snapshotHash([...input.video.mediaIds].sort()) ||
    original.path !==
      subtitleDestination({
        videoPath: input.video.path,
        language: original.language,
        forced: original.forced,
        hearingImpaired: original.hearingImpaired,
        format: provenance.format,
      })
  )
    throw new Error("Native additional subtitle installation binding changed");
  const operations = await installationOperations(
    tx,
    original,
    input.movieScope,
    budget,
  );
  const journals: NativeTerminalDescriptor["journals"] = operations.map(
    (operation) => ({
      operationId: operation.id,
      kind: "import" as const,
      source: path.join(
        `/data/${input.video.libraryKind}/.media-control/subtitles`,
        `${original.id}.${provenance.format}`,
      ),
      target: z.string().parse(original.path),
      sha256: z.string().parse(original.checksum),
      previousSha256: null,
    }),
  );
  return {
    installation: { subtitleId: original.id, journals },
    history: { operations, original },
  };
}

async function installationOperations(
  tx: Prisma.TransactionClient,
  original: NativeSubtitleSnapshot,
  movieScope?: MovieEditionScope,
  budget?: PublicationAuthorityReadBudget,
) {
  const marker = z
    .object({ movieInstallationV4: z.unknown().optional() })
    .parse(original.matchingEvidence).movieInstallationV4;
  if (marker !== undefined) {
    if (movieScope === undefined || budget === undefined)
      throw new Error(
        "Native movie subtitle installation requires exact versioned scope and caller budget",
      );
    return installedMovieSubtitleOperationV4(tx, original, movieScope, budget);
  }
  if (movieScope !== undefined && movieScope.edition !== "default")
    throw new Error(
      "Unscoped subtitle operations cannot authorize a named movie caption",
    );
  if (original.providerId === "manual") {
    const { uploadedBy } = z
      .object({ uploadedBy: z.uuid() })
      .parse(original.provenance);
    z.object({ ownerConfirmed: z.literal(true) }).parse(
      original.matchingEvidence,
    );
    const operation = await tx.operation.findUniqueOrThrow({
      where: { idempotencyKey: `manual-subtitle:${original.id}` },
    });
    budget?.consume(1);
    const payload = z
      .object({ subtitleId: z.uuid(), recoveryEpoch: z.int() })
      .parse(operation.payload);
    if (
      operation.kind !== "install_subtitle" ||
      operation.targetId !== original.assetId ||
      operation.userId !== uploadedBy ||
      payload.subtitleId !== original.id ||
      payload.recoveryEpoch !== original.ownershipEpoch
    )
      throw new Error("Native additional subtitle operation changed");
    return [{ id: operation.id, payload: operation.payload }];
  }
  return automaticInstallationOperations(tx, original, budget);
}

async function automaticInstallationOperations(
  tx: Prisma.TransactionClient,
  original: NativeSubtitleSnapshot,
  budget?: PublicationAuthorityReadBudget,
) {
  const evidence = z
    .object({
      targetAuthority: z.string(),
      target: z.object({
        language: z.string(),
        forced: z.boolean().optional(),
        hearingImpaired: z.enum(["any", "required", "excluded"]).optional(),
      }),
    })
    .parse(original.matchingEvidence);
  if (
    evidence.target.language !== original.language ||
    (evidence.target.forced !== undefined &&
      evidence.target.forced !== original.forced) ||
    (evidence.target.hearingImpaired === "required" &&
      original.hearingImpaired !== true) ||
    (evidence.target.hearingImpaired === "excluded" &&
      original.hearingImpaired !== false)
  )
    throw new Error("Native additional subtitle target changed");
  const rows = await tx.operation.findMany({
    where: {
      kind: "acquire_subtitles",
      targetId: original.assetId,
      payload: { path: ["recoveryEpoch"], equals: original.ownershipEpoch },
    },
    orderBy: { id: "asc" },
    take: budget?.take ?? 101,
  });
  budget?.consume(rows.length);
  if (rows.length > 100)
    throw new Error("Native subtitle installation lookup exceeds bound");
  const matches = rows.flatMap((row) => {
    const payload = z
      .object({
        assetId: z.string(),
        recoveryEpoch: z.int(),
        language: z.string(),
        forced: z.boolean().optional(),
        hearingImpaired: z.enum(["any", "required", "excluded"]).optional(),
        targetAuthority: z.string().optional(),
      })
      .parse(row.payload);
    const target = {
      language: payload.language,
      ...(payload.forced === undefined ? {} : { forced: payload.forced }),
      ...(payload.hearingImpaired === undefined
        ? {}
        : { hearingImpaired: payload.hearingImpaired }),
    };
    return payload.assetId === original.assetId &&
      payload.recoveryEpoch === original.ownershipEpoch &&
      payload.targetAuthority === evidence.targetAuthority &&
      snapshotHash(target) === snapshotHash(z.json().parse(evidence.target))
      ? [{ id: row.id, payload: row.payload }]
      : [];
  });
  if (matches.length === 0)
    throw new Error("Native additional subtitle installation is unproven");
  return matches;
}

function installationSnapshot(current: NativeSubtitleSnapshot, chain: Chain) {
  let snapshot = current;
  for (const item of chain) {
    const binding = item.binding.subtitles.find(
      (entry) => entry.id === current.id,
    );
    const before = item.subtitleSnapshots.find(
      (entry) => entry.id === current.id,
    );
    if (binding === undefined && before === undefined) continue;
    if (
      binding === undefined ||
      before === undefined ||
      snapshotHash({ ...before, ...binding.after }) !== snapshotHash(snapshot)
    )
      throw new Error("Native additional subtitle renewal changed");
    snapshot = before;
  }
  return snapshot;
}
