import {
  ChallengeProgressSchema,
  DiscordGuildIdSchema,
  type ChallengeProgress,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { parseProgressionJson } from "#src/progression/json.ts";

export type HomeChallenge = {
  runId: string;
  title: string;
  summary: string;
  /** Steps of the challenge done, out of `total`. */
  done: number;
  total: number;
};

/** "1 of 3": the top of the progress tree as a count of what is done. */
export function challengeCounts(progress: ChallengeProgress): {
  done: number;
  total: number;
} {
  if (progress.kind === "boolean") {
    return {
      done: progress.children.filter((child) => child.completed).length,
      total: progress.children.length,
    };
  }
  return {
    done: Math.min(Math.floor(progress.current), progress.target),
    total: progress.target,
  };
}

/**
 * The viewer's most recently updated active challenge run, from PostgreSQL.
 * `null` when none of the viewer's servers has challenge runs on, or the
 * viewer has no active run, or the run has no evaluated snapshot yet.
 */
export async function readHomeChallenge(input: {
  viewerDiscordId: DiscordAccountId;
  guildIds: readonly string[];
}): Promise<HomeChallenge | null> {
  const enabled = await Promise.all(
    input.guildIds.map((guildId) =>
      isPolicyEnabled("challenge_runs_enabled", {
        server: DiscordGuildIdSchema.parse(guildId),
      }),
    ),
  );
  if (!enabled.some(Boolean)) return null;
  const run = await prisma.challengeRun.findFirst({
    where: {
      ownerDiscordId: input.viewerDiscordId,
      runState: "active",
      currentSnapshotId: { not: null },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { templateVersion: true },
  });
  const snapshotId = run?.currentSnapshotId;
  if (run === null || snapshotId === null || snapshotId === undefined)
    return null;
  const snapshot = await prisma.challengeRunSnapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    select: { progressJson: true },
  });
  return {
    runId: run.id,
    title: run.templateVersion.title,
    summary: run.templateVersion.summary,
    ...challengeCounts(
      parseProgressionJson(snapshot.progressJson, ChallengeProgressSchema),
    ),
  };
}
