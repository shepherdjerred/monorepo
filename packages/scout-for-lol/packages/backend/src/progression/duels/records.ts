import type { Db } from "#src/database/index.ts";

export function duelRecordSubjectKeys(competitor: {
  readonly members: readonly { readonly playerId: number }[];
}) {
  const players = competitor.members
    .map((member) => member.playerId)
    .toSorted((left, right) => left - right);
  return {
    individuals: players.map((playerId) => `player:${playerId.toString()}`),
    pair: players.length === 2 ? `pair:${players.map(String).join("+")}` : null,
  };
}

function nextStreak(previous: number | null, won: boolean): number {
  if (previous === null) return won ? 1 : -1;
  if (won) return previous >= 0 ? previous + 1 : 1;
  return previous <= 0 ? previous - 1 : -1;
}

async function updateRecord(
  tx: Db,
  options: {
    readonly guildId: string;
    readonly scope: string;
    readonly subjectKey: string;
    readonly opponentKey: string;
    readonly gameResult: "won" | "lost" | null;
    readonly seriesResult: "won" | "lost" | null;
  },
): Promise<void> {
  const key = {
    guildId_scope_subjectKey_opponentKey: {
      guildId: options.guildId,
      scope: options.scope,
      subjectKey: options.subjectKey,
      opponentKey: options.opponentKey,
    },
  };
  const existing = await tx.duelRecord.findUnique({ where: key });
  const streak =
    options.gameResult === null
      ? (existing?.streak ?? 0)
      : nextStreak(existing?.streak ?? null, options.gameResult === "won");
  await tx.duelRecord.upsert({
    where: key,
    create: {
      guildId: options.guildId,
      scope: options.scope,
      subjectKey: options.subjectKey,
      opponentKey: options.opponentKey,
      games: options.gameResult === null ? 0 : 1,
      wins: options.gameResult === "won" ? 1 : 0,
      losses: options.gameResult === "lost" ? 1 : 0,
      series: options.seriesResult === null ? 0 : 1,
      seriesWins: options.seriesResult === "won" ? 1 : 0,
      seriesLosses: options.seriesResult === "lost" ? 1 : 0,
      streak,
    },
    update: {
      ...(options.gameResult === null
        ? {}
        : {
            games: { increment: 1 },
            wins: { increment: options.gameResult === "won" ? 1 : 0 },
            losses: { increment: options.gameResult === "lost" ? 1 : 0 },
            streak,
          }),
      series: { increment: options.seriesResult === null ? 0 : 1 },
      seriesWins: { increment: options.seriesResult === "won" ? 1 : 0 },
      seriesLosses: { increment: options.seriesResult === "lost" ? 1 : 0 },
    },
  });
}

async function updateStructuredSeries(
  tx: Db,
  options: {
    readonly guildId: string;
    readonly scope: string;
    readonly subjectKey: string;
    readonly won: boolean;
  },
): Promise<void> {
  await tx.duelRecord.upsert({
    where: {
      guildId_scope_subjectKey_opponentKey: {
        guildId: options.guildId,
        scope: options.scope,
        subjectKey: options.subjectKey,
        opponentKey: "",
      },
    },
    create: {
      guildId: options.guildId,
      scope: options.scope,
      subjectKey: options.subjectKey,
      series: 1,
      seriesWins: options.won ? 1 : 0,
      seriesLosses: options.won ? 0 : 1,
    },
    update: {
      series: { increment: 1 },
      seriesWins: { increment: options.won ? 1 : 0 },
      seriesLosses: { increment: options.won ? 0 : 1 },
    },
  });
}

export async function recordDuelSide(
  tx: Db,
  options: {
    readonly guildId: string;
    readonly own: ReturnType<typeof duelRecordSubjectKeys>;
    readonly opponent: ReturnType<typeof duelRecordSubjectKeys>;
    readonly gameResult: "won" | "lost" | null;
    readonly seriesResult: "won" | "lost" | null;
    readonly structured: boolean;
  },
): Promise<void> {
  for (const subjectKey of options.own.individuals) {
    await updateRecord(tx, {
      guildId: options.guildId,
      scope: "individual",
      subjectKey,
      opponentKey: "",
      gameResult: options.gameResult,
      seriesResult: options.seriesResult,
    });
    for (const opponentKey of options.opponent.individuals) {
      await updateRecord(tx, {
        guildId: options.guildId,
        scope: "head_to_head_individual",
        subjectKey,
        opponentKey,
        gameResult: options.gameResult,
        seriesResult: options.seriesResult,
      });
    }
    if (options.structured && options.seriesResult !== null) {
      await updateStructuredSeries(tx, {
        guildId: options.guildId,
        scope: "structured_individual",
        subjectKey,
        won: options.seriesResult === "won",
      });
    }
  }
  if (options.own.pair === null) return;
  await updateRecord(tx, {
    guildId: options.guildId,
    scope: "pair",
    subjectKey: options.own.pair,
    opponentKey: "",
    gameResult: options.gameResult,
    seriesResult: options.seriesResult,
  });
  if (options.opponent.pair !== null) {
    await updateRecord(tx, {
      guildId: options.guildId,
      scope: "head_to_head_pair",
      subjectKey: options.own.pair,
      opponentKey: options.opponent.pair,
      gameResult: options.gameResult,
      seriesResult: options.seriesResult,
    });
  }
  if (options.structured && options.seriesResult !== null) {
    await updateStructuredSeries(tx, {
      guildId: options.guildId,
      scope: "structured_pair",
      subjectKey: options.own.pair,
      won: options.seriesResult === "won",
    });
  }
}

export async function recordCommitteeSeriesOutcome(
  tx: Db,
  options: {
    readonly guildId: string;
    readonly winner: Parameters<typeof duelRecordSubjectKeys>[0];
    readonly loser: Parameters<typeof duelRecordSubjectKeys>[0];
    readonly structured: boolean;
  },
): Promise<void> {
  await recordDuelSide(tx, {
    guildId: options.guildId,
    own: duelRecordSubjectKeys(options.winner),
    opponent: duelRecordSubjectKeys(options.loser),
    gameResult: null,
    seriesResult: "won",
    structured: options.structured,
  });
  await recordDuelSide(tx, {
    guildId: options.guildId,
    own: duelRecordSubjectKeys(options.loser),
    opponent: duelRecordSubjectKeys(options.winner),
    gameResult: null,
    seriesResult: "lost",
    structured: options.structured,
  });
}
