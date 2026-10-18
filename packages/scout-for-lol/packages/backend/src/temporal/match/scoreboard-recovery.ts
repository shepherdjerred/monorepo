import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { gameResultTimestamp } from "@scout-for-lol/domain/artifacts/game-result.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { prisma } from "#src/database/index.ts";
import { getAccountConfigsByPuuids } from "#src/database/player-accounts.ts";
import { resolveResultEvidence } from "#src/evidence/results.ts";
import {
  freezeReportScoreboard,
  readReportScoreboard,
} from "#src/evidence/report-scoreboard.ts";
import { buildScoreboardReport } from "#src/league/tasks/postmatch/scoreboard-report.ts";
import { renderMatchNotificationArtifact } from "#src/temporal/notification-lane/notification-render.ts";
import { mintPostmatchIntents } from "#src/temporal/notification/match-intents.ts";

/** Report-ready evidence uses the ordinary durable render/mint lane, without full-match effects. */
export async function reconcileScoreboardReport(
  matchId: RiotMatchId,
): Promise<boolean> {
  let snapshot = await readReportScoreboard(matchId);
  if (snapshot === null) {
    const resolution = await resolveResultEvidence(matchId, []);
    if (resolution.kind !== "available") return false;
    const puuids = resolution.value.participants.flatMap((player) =>
      player.identity.kind === "riot"
        ? [LeaguePuuidSchema.parse(player.identity.puuid)]
        : [],
    );
    const players = await getAccountConfigsByPuuids(puuids, prisma);
    if (buildScoreboardReport(resolution.value, players) === null) return false;
    snapshot = await freezeReportScoreboard(matchId, resolution.value);
  }
  if (snapshot === null) return false;
  const row = await prisma.matchReportSnapshot.findUniqueOrThrow({
    where: { riotMatchId: matchId },
  });
  if (row.completedAt !== null) return true;
  const admission = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: matchId },
  });
  await renderMatchNotificationArtifact({
    riotMatchId: matchId,
    kind: "postmatch",
    postmatchMode:
      admission.policy === "FULL"
        ? { kind: "live" }
        : { kind: "historical", rankChanges: new Map() },
  });
  const summary = await mintPostmatchIntents(prisma, {
    matchId,
    puuids: snapshot.trackedPuuids,
    queue: snapshot.result,
    gameCreation: gameResultTimestamp(snapshot.result),
    createdAt: new Date(),
  });
  if (summary.conflicts > 0)
    throw new Error(`Conflicting report intents for ${matchId}`);
  await prisma.matchReportSnapshot.update({
    where: { riotMatchId: matchId },
    data: { completedAt: new Date() },
  });
  return true;
}
