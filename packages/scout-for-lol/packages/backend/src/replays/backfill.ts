import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { prisma } from "#src/database/index.ts";
import { lcuUuidsFor } from "#src/scout-client/identity-alias.ts";
import { resolveReplayProvenance } from "#src/scout-client/replay/evidence.ts";
import { validateReplayContainer } from "#src/scout-client/replay/container.ts";
import type { QualifiedReplayProvenance } from "#src/scout-client/replay/evidence-selection.ts";
import { MAX_PUBLIC_REPLAY_BYTES as MAX_REPLAY_BYTES } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { openReplayContent } from "./content.ts";
import type { StoredPublicReplay } from "./catalog.ts";

function hasCompleteMetadata(replay: StoredPublicReplay): boolean {
  return (
    replay.platformId !== null &&
    replay.gameBuild !== null &&
    replay.protocol !== null &&
    replay.durationSeconds !== null &&
    replay.mapId !== null &&
    replay.gameMode !== null &&
    replay.teamSizes !== null
  );
}

function requireConsistentFact(
  description: string,
  stored: unknown,
  observed: unknown,
): void {
  if (
    stored !== null &&
    observed !== null &&
    JSON.stringify(stored) !== JSON.stringify(observed)
  )
    throw new Error(
      `Existing replay ${description} contradicts its match provenance`,
    );
}

function missingPresentationMetadata(
  replay: StoredPublicReplay,
  provenance: QualifiedReplayProvenance,
) {
  requireConsistentFact("platform", replay.platformId, provenance.platformId);
  requireConsistentFact(
    "presentation metadata",
    replay.mapId,
    provenance.mapId,
  );
  requireConsistentFact(
    "presentation metadata",
    replay.gameMode,
    provenance.gameMode,
  );
  requireConsistentFact(
    "presentation metadata",
    replay.teamSizes,
    provenance.teamSizes,
  );
  return {
    platformId: provenance.platformId,
    ...(replay.mapId === null && provenance.mapId !== null
      ? { mapId: provenance.mapId }
      : {}),
    ...(replay.gameMode === null && provenance.gameMode !== null
      ? { gameMode: provenance.gameMode }
      : {}),
    ...(replay.teamSizes === null && provenance.teamSizes !== null
      ? { teamSizes: provenance.teamSizes }
      : {}),
  };
}

export function parseReplayBackfillArguments(args: readonly string[]): {
  readonly replayIds: string[];
  readonly apply: boolean;
} {
  const replayIds: string[] = [];
  let apply = false;
  for (const arg of args) {
    if (arg === "--apply") {
      if (apply) throw new Error("--apply may appear only once");
      apply = true;
    } else if (arg.startsWith("--replay-id=")) {
      replayIds.push(z.uuid().parse(arg.slice("--replay-id=".length)));
    } else {
      throw new Error(`Unknown replay metadata backfill argument: ${arg}`);
    }
  }
  if (replayIds.length === 0 || new Set(replayIds).size !== replayIds.length)
    throw new Error(
      "Specify each exact --replay-id=<uuid> once; no implicit bulk target",
    );
  return { replayIds, apply };
}

/** Legacy completion is revalidated, not treated as a new metadata attestation. */
export async function backfillReplayMetadata(
  replayId: string,
  apply: boolean,
): Promise<{
  readonly replayId: string;
  readonly outcome: "already_present" | "validated_dry_run" | "updated";
}> {
  const replay = await prisma.scoutClientReplayArtifact.findUniqueOrThrow({
    where: { id: z.uuid().parse(replayId) },
    include: {
      device: { select: { id: true, ownerId: true, appVersion: true } },
    },
  });
  if (replay.uploadState !== "COMPLETED")
    throw new Error("Only completed replay artifacts can be backfilled");
  if (hasCompleteMetadata(replay))
    return { replayId, outcome: "already_present" };
  if (replay.bytes <= 0n || replay.bytes > BigInt(MAX_REPLAY_BYTES))
    throw new Error("Replay exceeds the validated backfill size bound");
  const provenance = await resolveReplayProvenance(
    { gameId: replay.gameId, platformId: replay.platformId },
    {
      deviceId: replay.device.id,
      ownerId: DiscordAccountIdSchema.parse(replay.device.ownerId),
      appVersion: replay.device.appVersion,
    },
  );
  if (provenance === null)
    throw new Error(
      "Replay provenance is unavailable; metadata was not guessed",
    );
  const presentationMetadata = missingPresentationMetadata(replay, provenance);

  const directory = await mkdtemp(
    path.join(tmpdir(), "scout-replay-metadata-"),
  );
  const replayPath = path.join(directory, "replay.rofl");
  try {
    const file = await open(replayPath, "wx", 0o600);
    const hasher = new Bun.CryptoHasher("sha256");
    try {
      const stream = await openReplayContent(
        replay,
        null,
        AbortSignal.timeout(120_000),
      );
      const reader = stream.getReader();
      try {
        let next = await reader.read();
        while (!next.done) {
          hasher.update(next.value);
          await file.writeFile(next.value);
          next = await reader.read();
        }
      } finally {
        await reader.cancel();
      }
    } finally {
      await file.close();
    }
    if (hasher.digest("hex") !== replay.digest)
      throw new Error("Stored replay SHA-256 does not match its artifact");
    const metadata = await validateReplayContainer(
      replayPath,
      Number(replay.bytes),
      provenance,
      new Set([
        provenance.localPuuid,
        ...(await lcuUuidsFor(LeaguePuuidSchema.parse(provenance.localPuuid))),
      ]),
    );
    if (
      (replay.gameBuild !== null && replay.gameBuild !== metadata.gameBuild) ||
      (replay.protocol !== null && replay.protocol !== metadata.protocol) ||
      (replay.durationSeconds !== null &&
        replay.durationSeconds !== metadata.durationSeconds)
    )
      throw new Error(
        "Existing replay metadata contradicts its validated bytes",
      );
    if (!apply) return { replayId, outcome: "validated_dry_run" };
    const updated = await prisma.scoutClientReplayArtifact.updateMany({
      where: {
        id: replay.id,
        uploadState: "COMPLETED",
        digest: replay.digest,
        objectKey: replay.objectKey,
        platformId: replay.platformId,
        updatedAt: replay.updatedAt,
      },
      data: {
        ...metadata,
        ...presentationMetadata,
      },
    });
    if (updated.count !== 1)
      throw new Error(
        "Replay metadata changed during validation; no row was overwritten",
      );
    return { replayId, outcome: "updated" };
  } finally {
    // directory is a newly created, absolute, task-specific temporary directory.
    await rm(directory, { recursive: true, force: true });
  }
}
