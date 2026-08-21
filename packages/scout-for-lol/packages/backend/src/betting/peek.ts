import {
  BucksPoolRosterSchema,
  BucksPredictionSchema,
  type BucksPoolParticipant,
  type BucksPrediction,
  type DiscordAccountId,
  type DiscordGuildId,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { predictionProbabilityForTeam } from "#src/betting/prediction.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

type PeekPool = {
  matchId: string;
  roster: string;
  poolState: string;
  peekAvailableAt: Date;
  predictionJson: string | null;
};

type PeekSubject = {
  pool: PeekPool;
  participant: BucksPoolParticipant;
};

// Match ActiveGame's lifecycle: this preserves a friendly terminal-state
// response immediately after settlement without letting a reusable tracked
// alias match the guild's entire pool history forever.
export const RECENT_RESOLVED_PEEK_WINDOW_MS = 3 * 60 * 60 * 1000;

function parseRoster(raw: string): BucksPoolParticipant[] {
  return BucksPoolRosterSchema.parse(JSON.parse(raw)).participants;
}

function findSubject(
  pools: readonly PeekPool[],
  requestedAlias: string,
): PeekSubject | undefined {
  const normalized = requestedAlias.trim().toLowerCase();
  for (const pool of pools) {
    const participant = parseRoster(pool.roster).find(
      (candidate) => candidate.trackedAlias?.toLowerCase() === normalized,
    );
    if (participant !== undefined) {
      return { pool, participant };
    }
  }
  return undefined;
}

function availableAliases(pools: readonly PeekPool[]): string[] {
  return [
    ...new Set(
      pools.flatMap((pool) =>
        parseRoster(pool.roster).flatMap((participant) =>
          participant.trackedAlias === undefined
            ? []
            : [participant.trackedAlias],
        ),
      ),
    ),
  ];
}

function parsePrediction(raw: string | null): BucksPrediction | undefined {
  if (raw === null) {
    return undefined;
  }
  return BucksPredictionSchema.parse(JSON.parse(raw));
}

function perspectiveDriver(driver: string, teamId: RiotTeamId): string {
  if (teamId === 100) {
    return driver
      .replace(/^Blue /, "your team ")
      .replace(/^Red /, "the opposing team ");
  }
  return driver
    .replace(/^Red /, "your team ")
    .replace(/^Blue /, "the opposing team ");
}

export function renderPeekEstimate(input: {
  prediction: BucksPrediction;
  teamId: RiotTeamId;
}): string {
  const winPercent = Math.round(
    predictionProbabilityForTeam(input.prediction, input.teamId) * 100,
  );
  const quality =
    "version" in input.prediction
      ? input.prediction.dataQuality
      : input.prediction.confidence;
  const drivers = input.prediction.drivers
    .slice(0, 2)
    .map((driver) => perspectiveDriver(driver, input.teamId));
  return [
    `🔮 Experimental estimate: **${winPercent.toString()}% win / ${(100 - winPercent).toString()}% loss** · ${quality} data quality.`,
    ...(drivers.length === 0 ? [] : [`Drivers: ${drivers.join("; ")}.`]),
  ].join("\n");
}

export type PeekResult =
  | { kind: "revealed"; content: string }
  | { kind: "no_pass" }
  | { kind: "expired_pass"; expiredAt: Date }
  | { kind: "not_ready"; availableAt: Date }
  | { kind: "unknown_game"; validAliases: string[] }
  | { kind: "resolved_game" }
  | { kind: "unavailable_analysis" };

export async function peekAtGame(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    requestedAlias: string;
    now?: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PeekResult> {
  const now = input.now ?? new Date();
  const account = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: { peekPassExpiresAt: true },
  });
  const passExpiresAt = account?.peekPassExpiresAt;
  if (passExpiresAt === null || passExpiresAt === undefined) {
    return { kind: "no_pass" };
  }
  if (passExpiresAt.getTime() <= now.getTime()) {
    return { kind: "expired_pass", expiredAt: passExpiresAt };
  }

  const candidatePools = await prismaClient.bucksMatchPool.findMany({
    where: {
      serverId: input.serverId,
      OR: [
        { poolState: { in: ["open", "closed"] } },
        {
          poolState: { in: ["settled", "voided"] },
          settledAt: {
            gte: new Date(now.getTime() - RECENT_RESOLVED_PEEK_WINDOW_MS),
          },
        },
      ],
    },
    select: {
      matchId: true,
      roster: true,
      poolState: true,
      peekAvailableAt: true,
      predictionJson: true,
    },
    // An alias can have overlapping unresolved and terminal pools. Select its
    // newest detected game first, then interpret that pool's lifecycle state.
    orderBy: [{ detectedAt: "desc" }, { matchId: "desc" }],
  });
  const subject = findSubject(candidatePools, input.requestedAlias);
  if (subject === undefined) {
    const unresolvedPools = candidatePools.filter(
      (pool) => pool.poolState === "open" || pool.poolState === "closed",
    );
    return {
      kind: "unknown_game",
      validAliases: availableAliases(unresolvedPools),
    };
  }
  if (
    subject.pool.poolState === "settled" ||
    subject.pool.poolState === "voided"
  ) {
    return { kind: "resolved_game" };
  }

  if (now.getTime() < subject.pool.peekAvailableAt.getTime()) {
    return { kind: "not_ready", availableAt: subject.pool.peekAvailableAt };
  }
  const prediction = parsePrediction(subject.pool.predictionJson);
  if (prediction === undefined) {
    return { kind: "unavailable_analysis" };
  }
  return {
    kind: "revealed",
    content: renderPeekEstimate({
      prediction,
      teamId: subject.participant.teamId,
    }),
  };
}

export function describePeekResult(result: PeekResult): string {
  switch (result.kind) {
    case "revealed":
      return result.content;
    case "no_pass":
      return "🔒 You need an active peek pass. Get a quote with `/bb pass`.";
    case "expired_pass":
      return `⌛ Your peek pass expired <t:${Math.floor(result.expiredAt.getTime() / 1000).toString()}:R>. Get a new quote with \`/bb pass\`.`;
    case "not_ready":
      return `⏳ This peek will be ready <t:${Math.floor(result.availableAt.getTime() / 1000).toString()}:R>.`;
    case "unknown_game":
      return result.validAliases.length === 0
        ? "No tracked games are available to peek right now."
        : `No current game for that alias. Try: ${result.validAliases.map((alias) => `\`${alias}\``).join(", ")}.`;
    case "resolved_game":
      return "That game has already resolved, so its private peek is no longer available. The settlement recap may show the estimate.";
    case "unavailable_analysis":
      return "Scout couldn't produce a reliable pregame analysis for this game, so there is nothing to reveal.";
  }
}
