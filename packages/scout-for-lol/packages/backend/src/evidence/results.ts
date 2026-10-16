import {
  GameResultSchema,
  resolveGameResult,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import type { ArtifactResolution } from "@scout-for-lol/domain/artifacts/resolution.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedMatchPayload } from "#src/report-lake/receipted-archive.ts";
import { gameResultFromMatch } from "#src/scout-client/canonical/riot-result.ts";

/** One result policy serves owner history and other projections. */
export async function resolveResultEvidence(
  matchId: RiotMatchId,
  candidates: readonly GameResult[],
): Promise<ArtifactResolution<GameResult>> {
  const stored = await prisma.matchResultEvidence.findMany({
    where: {
      riotMatchId: matchId,
      OR: [
        { source: "RIOT" },
        { clientObservation: { disposition: "ACCEPTED" } },
      ],
    },
    orderBy: [{ source: "asc" }, { sourceId: "asc" }],
  });
  const all = [
    ...new Map(
      [
        ...candidates,
        ...stored.map((row) => GameResultSchema.parse(row.result)),
      ].map((result) => [`${result.source}:${result.sourceId}`, result]),
    ).values(),
  ];
  const archive = await storedRawArchiveDescriptor(prisma, matchId, "match");
  const value =
    archive === null
      ? resolveGameResult(all)
      : gameResultFromMatch(await readArchivedMatchPayload(archive, matchId));
  const evidence = all.map(({ source, sourceId }) => ({ source, sourceId }));
  if (value === null)
    return all.length === 0
      ? { kind: "unavailable", reason: "No result evidence" }
      : { kind: "conflict", evidence };
  return {
    kind: "available",
    value,
    evidence,
    frozen: archive !== null,
    coverage: value.participants.some(
      (player) =>
        player.identity.kind === "unresolved" ||
        player.identity.kind === "local" ||
        player.name === null ||
        player.kills === null ||
        player.gold === null ||
        player.deaths === null ||
        player.assists === null ||
        player.damageToChampions === null ||
        player.minions === null ||
        player.level === null,
    )
      ? "partial"
      : "complete",
  };
}
