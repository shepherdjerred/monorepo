import { prisma } from "@shepherdjerred/birmel/database/index.js";
import { getGuildOwner } from "@shepherdjerred/birmel/database/repositories/guild-owner.js";
import { getAllCandidates } from "@shepherdjerred/birmel/elections/candidates.js";

type ElectionResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

export async function handleGetOwner(
  guildId: string | undefined,
): Promise<ElectionResult> {
  if (guildId == null || guildId.length === 0) {
    return { success: false, message: "guildId is required" };
  }
  const owner = await getGuildOwner(guildId);
  if (owner == null) {
    return {
      success: false,
      message: `No owner record found for guild ${guildId}`,
    };
  }
  return {
    success: true,
    message: `Current owner: ${owner.currentOwner} (${owner.nickname})`,
    data: {
      currentOwner: owner.currentOwner,
      nickname: owner.nickname,
      lastElectionAt: owner.lastElectionAt?.toISOString(),
    },
  };
}

export async function handleGetHistory(
  guildId: string | undefined,
  limit: number | undefined,
): Promise<ElectionResult> {
  if (guildId == null || guildId.length === 0) {
    return { success: false, message: "guildId is required" };
  }
  const elections = await prisma.electionPoll.findMany({
    where: { guildId },
    orderBy: { scheduledStart: "desc" },
    take: limit ?? 10,
  });
  const data = elections.map((e) => ({
    id: e.id,
    pollType: e.pollType,
    status: e.status,
    winner: e.winner ?? undefined,
    candidates: JSON.parse(e.candidates) as string[],
    voteCounts:
      e.voteCounts != null && e.voteCounts.length > 0
        ? (JSON.parse(e.voteCounts) as Record<string, number>)
        : undefined,
    scheduledStart: e.scheduledStart.toISOString(),
    scheduledEnd: e.scheduledEnd.toISOString(),
    actualEnd: e.actualEnd?.toISOString(),
  }));
  return {
    success: true,
    message: `Found ${data.length.toString()} elections`,
    data: { elections: data },
  };
}

export async function handleGetCurrent(
  guildId: string | undefined,
): Promise<ElectionResult> {
  if (guildId == null || guildId.length === 0) {
    return { success: false, message: "guildId is required" };
  }
  const election = await prisma.electionPoll.findFirst({
    where: { guildId, status: { in: ["scheduled", "active"] } },
    orderBy: { scheduledStart: "desc" },
  });
  if (election == null) {
    return { success: false, message: "No active or scheduled election" };
  }
  return {
    success: true,
    message: `Found ${election.status} ${election.pollType}`,
    data: {
      id: election.id,
      pollType: election.pollType,
      status: election.status,
      candidates: JSON.parse(election.candidates) as string[],
      scheduledStart: election.scheduledStart.toISOString(),
      scheduledEnd: election.scheduledEnd.toISOString(),
      messageId: election.messageId ?? undefined,
      channelId: election.channelId,
    },
  };
}

export async function handleGetStats(
  guildId: string | undefined,
): Promise<ElectionResult> {
  if (guildId == null || guildId.length === 0) {
    return { success: false, message: "guildId is required" };
  }
  const elections = await prisma.electionPoll.findMany({
    where: { guildId, status: "completed" },
    orderBy: { actualEnd: "desc" },
  });
  const totalElections = elections.filter(
    (e) => e.pollType === "election",
  ).length;
  const totalRunoffs = elections.filter((e) => e.pollType === "runoff").length;
  const winsByCandidate: Record<string, number> = {};
  let totalVotesCast = 0;
  for (const e of elections) {
    if (e.winner != null && e.winner.length > 0) {
      winsByCandidate[e.winner] = (winsByCandidate[e.winner] ?? 0) + 1;
    }
    if (e.voteCounts != null && e.voteCounts.length > 0) {
      const votes = JSON.parse(e.voteCounts) as Record<string, number>;
      for (const count of Object.values(votes)) {
        totalVotesCast += count;
      }
    }
  }
  return {
    success: true,
    message: `Found ${elections.length.toString()} completed elections`,
    data: {
      totalElections,
      totalRunoffs,
      winsByCandidate,
      totalVotesCast,
      averageVotesPerElection:
        elections.length > 0
          ? Math.round(totalVotesCast / elections.length)
          : 0,
      mostRecentWinner: elections[0]?.winner ?? undefined,
    },
  };
}

export function handleGetCandidates(): ElectionResult {
  const candidates = getAllCandidates();
  return {
    success: true,
    message: `Found ${candidates.length.toString()} candidates`,
    data: { candidates, count: candidates.length },
  };
}

export async function handleGetById(
  electionId: number | undefined,
): Promise<ElectionResult> {
  if (electionId == null) {
    return { success: false, message: "electionId is required" };
  }
  const election = await prisma.electionPoll.findUnique({
    where: { id: electionId },
  });
  if (election == null) {
    return {
      success: false,
      message: `Election ${electionId.toString()} not found`,
    };
  }
  return {
    success: true,
    message: `Found ${election.pollType} (${election.status})`,
    data: {
      id: election.id,
      guildId: election.guildId,
      channelId: election.channelId,
      messageId: election.messageId ?? undefined,
      pollType: election.pollType,
      status: election.status,
      candidates: JSON.parse(election.candidates) as string[],
      winner: election.winner ?? undefined,
      voteCounts:
        election.voteCounts != null && election.voteCounts.length > 0
          ? (JSON.parse(election.voteCounts) as Record<string, number>)
          : undefined,
      scheduledStart: election.scheduledStart.toISOString(),
      scheduledEnd: election.scheduledEnd.toISOString(),
      actualStart: election.actualStart?.toISOString(),
      actualEnd: election.actualEnd?.toISOString(),
    },
  };
}

export async function handleGetCandidateStats(
  guildId: string | undefined,
  candidateName: string | undefined,
): Promise<ElectionResult> {
  if (
    guildId == null ||
    guildId.length === 0 ||
    candidateName == null ||
    candidateName.length === 0
  ) {
    return {
      success: false,
      message: "guildId and candidateName are required",
    };
  }
  const elections = await prisma.electionPoll.findMany({
    where: { guildId, status: "completed" },
    orderBy: { actualEnd: "desc" },
  });
  const candidateLower = candidateName.toLowerCase();
  let totalElectionsParticipated = 0;
  let wins = 0;
  let totalVotesReceived = 0;
  let lastElectionDate: string | undefined;
  let lastWinDate: string | undefined;
  for (const e of elections) {
    const candidates = (JSON.parse(e.candidates) as string[]).map((c) =>
      c.toLowerCase(),
    );
    if (candidates.includes(candidateLower)) {
      totalElectionsParticipated++;
      if (
        (lastElectionDate == null || lastElectionDate.length === 0) &&
        e.actualEnd != null
      ) {
        lastElectionDate = e.actualEnd.toISOString();
      }
      if (e.winner?.toLowerCase() === candidateLower) {
        wins++;
        if (
          (lastWinDate == null || lastWinDate.length === 0) &&
          e.actualEnd != null
        ) {
          lastWinDate = e.actualEnd.toISOString();
        }
      }
      if (e.voteCounts != null && e.voteCounts.length > 0) {
        const votes = JSON.parse(e.voteCounts) as Record<string, number>;
        for (const [name, count] of Object.entries(votes)) {
          if (name.toLowerCase() === candidateLower) {
            totalVotesReceived += count;
          }
        }
      }
    }
  }
  return {
    success: true,
    message: `Stats for ${candidateName}: ${wins.toString()} wins in ${totalElectionsParticipated.toString()} elections`,
    data: {
      candidateName,
      totalElectionsParticipated,
      wins,
      winRate:
        totalElectionsParticipated > 0
          ? Math.round((wins / totalElectionsParticipated) * 100)
          : 0,
      totalVotesReceived,
      averageVotesPerElection:
        totalElectionsParticipated > 0
          ? Math.round(totalVotesReceived / totalElectionsParticipated)
          : 0,
      lastElectionDate,
      lastWinDate,
    },
  };
}
