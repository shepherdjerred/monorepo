import type {
  DuelCompetitor,
  DuelObjective,
  DuelResultEvidence,
  DuelRulesetV1,
  DuelTimelineInput,
} from "#src/model/progression/duel.ts";

type ObjectiveCrossing = {
  competitorId: string;
  objective: DuelObjective;
  timestampMs: number;
};

function competitorForPuuid(
  competitors: readonly DuelCompetitor[],
  puuid: string,
): DuelCompetitor | undefined {
  return competitors.find((competitor) =>
    competitor.accounts.some((account) => account.puuid === puuid),
  );
}

function validateDuelRoster(
  competitors: readonly DuelCompetitor[],
  participants: DuelTimelineInput["participants"],
): string | null {
  if (competitors.length !== 2) return "A duel game requires two competitors";
  const expectedPuuids = competitors.flatMap((competitor) =>
    competitor.accounts.map((account) => account.puuid),
  );
  const actualPuuids = participants.map((participant) => participant.puuid);
  if (
    expectedPuuids.length !== actualPuuids.length ||
    expectedPuuids.some((puuid) => !actualPuuids.includes(puuid)) ||
    actualPuuids.some((puuid) => !expectedPuuids.includes(puuid))
  ) {
    return "The completed game roster did not match the frozen duel roster";
  }
  const competitorTeamIds = competitors.map(
    (competitor) =>
      new Set(
        participants
          .filter((participant) =>
            competitor.accounts.some(
              (account) => account.puuid === participant.puuid,
            ),
          )
          .map((participant) => participant.teamId),
      ),
  );
  if (competitorTeamIds.some((teamIds) => teamIds.size !== 1)) {
    return "A frozen 2v2 pair was split across game teams";
  }
  const firstTeamId = competitorTeamIds[0]?.values().next().value;
  const secondTeamId = competitorTeamIds[1]?.values().next().value;
  return firstTeamId === secondTeamId
    ? "Duel competitors appeared on the same game team"
    : null;
}

function killCrossings(
  ruleset: DuelRulesetV1,
  competitors: readonly DuelCompetitor[],
  input: DuelTimelineInput,
): ObjectiveCrossing[] {
  if (ruleset.killTarget === null) return [];
  const counts = new Map<string, number>();
  const crossings: ObjectiveCrossing[] = [];
  for (const kill of input.kills.toSorted(
    (left, right) => left.timestampMs - right.timestampMs,
  )) {
    const competitor = competitorForPuuid(competitors, kill.killerPuuid);
    if (competitor === undefined) continue;
    const count = (counts.get(competitor.id) ?? 0) + 1;
    counts.set(competitor.id, count);
    if (count === ruleset.killTarget) {
      crossings.push({
        competitorId: competitor.id,
        objective: "kills",
        timestampMs: kill.timestampMs,
      });
    }
  }
  return crossings;
}

function laneCsCrossings(
  ruleset: DuelRulesetV1,
  competitors: readonly DuelCompetitor[],
  input: DuelTimelineInput,
): ObjectiveCrossing[] {
  if (ruleset.laneCsTarget === null) return [];
  const crossed = new Set<string>();
  const crossings: ObjectiveCrossing[] = [];
  for (const frame of input.frames.toSorted(
    (left, right) => left.timestampMs - right.timestampMs,
  )) {
    for (const competitor of competitors) {
      if (crossed.has(competitor.id)) continue;
      const laneCs = frame.participants
        .filter((participant) =>
          competitor.accounts.some(
            (account) => account.puuid === participant.puuid,
          ),
        )
        .reduce((total, participant) => total + participant.minionsKilled, 0);
      if (laneCs >= ruleset.laneCsTarget) {
        crossed.add(competitor.id);
        crossings.push({
          competitorId: competitor.id,
          objective: "lane_cs",
          timestampMs: frame.timestampMs,
        });
      }
    }
  }
  return crossings;
}

function turretCrossings(
  ruleset: DuelRulesetV1,
  competitors: readonly DuelCompetitor[],
  input: DuelTimelineInput,
): ObjectiveCrossing[] {
  if (!ruleset.firstTurret) return [];
  const sorted = input.turretKills.toSorted(
    (left, right) => left.timestampMs - right.timestampMs,
  );
  const first = sorted[0];
  if (first === undefined) return [];
  return sorted
    .filter((turret) => turret.timestampMs === first.timestampMs)
    .flatMap((turret) => {
      const defendingCompetitor = competitors.find((competitor) =>
        competitor.accounts.some((account) =>
          input.participants.some(
            (participant) =>
              participant.puuid === account.puuid &&
              participant.teamId === turret.destroyedTeamId,
          ),
        ),
      );
      const winningCompetitor = competitors.find(
        (competitor) => competitor.id !== defendingCompetitor?.id,
      );
      return defendingCompetitor === undefined ||
        winningCompetitor === undefined
        ? []
        : [
            {
              competitorId: winningCompetitor.id,
              objective: "first_turret" as const,
              timestampMs: turret.timestampMs,
            },
          ];
    });
}

function reviewEvidence(
  input: DuelTimelineInput,
  reason: string,
): DuelResultEvidence {
  return {
    matchId: input.matchId,
    state: "needs_review",
    winnerCompetitorId: null,
    objective: null,
    objectiveTimestampMs: null,
    reason,
    participantPuuids: input.participants.map(
      (participant) => participant.puuid,
    ),
    timelineComplete: input.timelineComplete,
  };
}

export function evaluateDuelGame(
  ruleset: DuelRulesetV1,
  competitors: readonly DuelCompetitor[],
  input: DuelTimelineInput,
): DuelResultEvidence {
  const rosterIssue = validateDuelRoster(competitors, input.participants);
  if (rosterIssue !== null) return reviewEvidence(input, rosterIssue);
  if (!input.timelineComplete) {
    return reviewEvidence(input, "Complete timeline evidence is unavailable");
  }
  const crossings = [
    ...killCrossings(ruleset, competitors, input),
    ...laneCsCrossings(ruleset, competitors, input),
    ...turretCrossings(ruleset, competitors, input),
  ].toSorted((left, right) => left.timestampMs - right.timestampMs);
  const first = crossings[0];
  if (first === undefined) {
    return reviewEvidence(
      input,
      input.completed
        ? "The game completed without a configured objective crossing"
        : "No configured objective has been reached",
    );
  }
  const simultaneousCompetitors = new Set(
    crossings
      .filter((crossing) => crossing.timestampMs === first.timestampMs)
      .map((crossing) => crossing.competitorId),
  );
  if (simultaneousCompetitors.size > 1) {
    return reviewEvidence(
      input,
      "Opposing competitors crossed objectives at the same recorded time",
    );
  }
  return {
    matchId: input.matchId,
    state: "verified",
    winnerCompetitorId: first.competitorId,
    objective: first.objective,
    objectiveTimestampMs: first.timestampMs,
    reason: null,
    participantPuuids: input.participants.map(
      (participant) => participant.puuid,
    ),
    timelineComplete: true,
  };
}
