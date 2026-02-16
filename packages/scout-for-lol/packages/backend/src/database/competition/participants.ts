import {
  type CompetitionId,
  type DiscordAccountId,
  type ParticipantStatus,
  ParticipantStatusSchema,
  type PlayerId,
} from "@scout-for-lol/data";
import {
  type CompetitionParticipant,
  type PrismaClient,
} from "@scout-for-lol/backend/generated/prisma/client/index.js";
import { isCompetitionActive } from "@scout-for-lol/backend/database/competition/validation.ts";
import { match } from "ts-pattern";

// ============================================================================
// Add Participant
// ============================================================================

/**
 * Add a participant to a competition with JOINED or INVITED status
 *
 * @param options - Function options
 * @param options.prisma - Prisma client instance
 * @param options.competitionId - Competition ID
 * @param options.playerId - Player ID
 * @param options.status - JOINED or INVITED
 * @param options.invitedBy - Discord user ID of inviter (required for INVITED status)
 * @returns Created participant record
 * @throws If competition not found, participant limit reached, or duplicate participant
 */
export async function addParticipant(options: {
  prisma: PrismaClient;
  competitionId: CompetitionId;
  playerId: PlayerId;
  status: ParticipantStatus;
  invitedBy?: DiscordAccountId;
}): Promise<CompetitionParticipant> {
  const { prisma, competitionId, playerId, status, invitedBy } = options;
  const now = new Date();

  // Get competition to check limits and status
  // Use getCompetitionById to ensure dates are populated from seasonId
  const { getCompetitionById } = await import("./queries.js");
  const competition = await getCompetitionById(prisma, competitionId);

  if (!competition) {
    throw new Error(`Competition ${competitionId.toString()} not found`);
  }

  // Check if competition is active (not cancelled, not ended)
  // Season-based competitions now have endDate populated from the season
  const active = isCompetitionActive(competition.isCancelled, competition.endDate, now);

  if (!active) {
    throw new Error("Cannot join an inactive competition");
  }

  // Count current active participants (not LEFT)
  const activeParticipantCount = await prisma.competitionParticipant.count({
    where: {
      competitionId,
      status: { not: "LEFT" },
    },
  });

  if (activeParticipantCount >= competition.maxParticipants) {
    throw new Error(`Competition has reached maximum participants (${competition.maxParticipants.toString()})`);
  }

  // Check if participant already exists
  const existing = await prisma.competitionParticipant.findUnique({
    where: {
      competitionId_playerId: {
        competitionId,
        playerId,
      },
    },
  });

  if (existing) {
    // If they previously left, they cannot rejoin
    if (existing.status === "LEFT") {
      throw new Error("Cannot rejoin a competition after leaving");
    }

    // If they're already joined or invited, this is a duplicate
    throw new Error(`Player ${playerId.toString()} is already a participant with status ${existing.status}`);
  }

  // Create the participant
  return await prisma.competitionParticipant.create({
    data: {
      competitionId,
      playerId,
      status,
      invitedBy: status === "INVITED" ? (invitedBy ?? null) : null,
      invitedAt: status === "INVITED" ? now : null,
      joinedAt: status === "JOINED" ? now : null,
      leftAt: null,
    },
  });
}

// ============================================================================
// Update Participant Status
// ============================================================================

/**
 * Transition a participant from INVITED to JOINED
 *
 * @param prisma - Prisma client instance
 * @param competitionId - Competition ID
 * @param playerId - Player ID
 * @returns Updated participant record
 * @throws If participant not found or not in INVITED status
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  competitionId: number,
  playerId: number,
): Promise<CompetitionParticipant> {
  const participant = await prisma.competitionParticipant.findUnique({
    where: {
      competitionId_playerId: {
        competitionId,
        playerId,
      },
    },
  });

  if (!participant) {
    throw new Error("Participant not found");
  }

  if (participant.status !== "INVITED") {
    throw new Error(`Cannot accept invitation - current status is ${participant.status}`);
  }

  return await prisma.competitionParticipant.update({
    where: {
      competitionId_playerId: {
        competitionId,
        playerId,
      },
    },
    data: {
      status: "JOINED",
      joinedAt: new Date(),
    },
  });
}

// ============================================================================
// Remove Participant
// ============================================================================

/**
 * Remove a participant from a competition (soft delete - sets status to LEFT)
 *
 * @param prisma - Prisma client instance
 * @param competitionId - Competition ID
 * @param playerId - Player ID
 * @returns Updated participant record with LEFT status
 * @throws If participant not found or already left
 */
export async function removeParticipant(
  prisma: PrismaClient,
  competitionId: number,
  playerId: number,
): Promise<CompetitionParticipant> {
  const participant = await prisma.competitionParticipant.findUnique({
    where: {
      competitionId_playerId: {
        competitionId,
        playerId,
      },
    },
  });

  if (!participant) {
    throw new Error(
      `Participant not found: competitionId=${competitionId.toString()}, playerId=${playerId.toString()}`,
    );
  }

  if (participant.status === "LEFT") {
    throw new Error("Participant has already left the competition");
  }

  return await prisma.competitionParticipant.update({
    where: {
      competitionId_playerId: {
        competitionId,
        playerId,
      },
    },
    data: {
      status: "LEFT",
      leftAt: new Date(),
    },
  });
}

// ============================================================================
// Query Participants
// ============================================================================

/**
 * Get all participants for a competition, optionally filtered by status
 *
 * @param prisma - Prisma client instance
 * @param competitionId - Competition ID
 * @param statusFilter - Optional status filter (JOINED, INVITED, or LEFT)
 * @param includePlayer - Whether to include Player relation data
 * @returns Array of participants
 */
export async function getParticipants(
  prisma: PrismaClient,
  competitionId: CompetitionId,
  statusFilter?: ParticipantStatus,
  includePlayer = false,
): Promise<CompetitionParticipant[]> {
  return await prisma.competitionParticipant.findMany({
    where: {
      competitionId,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    ...(includePlayer ? { include: { player: true } } : {}),
    orderBy: {
      joinedAt: "asc",
    },
  });
}

/**
 * Get participant status for a specific player in a competition
 *
 * @param prisma - Prisma client instance
 * @param competitionId - Competition ID
 * @param playerId - Player ID
 * @returns Participant status or null if not a participant
 */
export async function getParticipantStatus(
  prisma: PrismaClient,
  competitionId: number,
  playerId: number,
): Promise<ParticipantStatus | null> {
  const participant = await prisma.competitionParticipant.findUnique({
    where: {
      competitionId_playerId: {
        competitionId,
        playerId,
      },
    },
    select: {
      status: true,
    },
  });

  if (!participant) {
    return null;
  }

  // Validate status with Zod schema
  const statusResult = ParticipantStatusSchema.safeParse(participant.status);
  if (!statusResult.success) {
    throw new Error(`Invalid participant status in database: ${participant.status}`);
  }

  return statusResult.data;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a player can join a competition
 *
 * Validates:
 * - Competition exists and is active
 * - Under participant limit
 * - Player is not already a participant (or hasn't left)
 *
 * @param prisma - Prisma client instance
 * @param competitionId - Competition ID
 * @param playerId - Player ID
 * @returns Object with canJoin boolean and optional reason string
 */
export async function canJoinCompetition(
  prisma: PrismaClient,
  competitionId: CompetitionId,
  playerId: PlayerId,
): Promise<{ canJoin: boolean; reason?: string }> {
  // Check if competition exists
  // Use getCompetitionById to ensure dates are populated from seasonId
  const { getCompetitionById } = await import("./queries.js");
  const competition = await getCompetitionById(prisma, competitionId);

  if (!competition) {
    return { canJoin: false, reason: "Competition not found" };
  }

  // Check if competition is active
  // Season-based competitions now have endDate populated from the season
  const now = new Date();
  const active = isCompetitionActive(competition.isCancelled, competition.endDate, now);

  if (!active) {
    if (competition.isCancelled) {
      return { canJoin: false, reason: "Competition is cancelled" };
    }
    return { canJoin: false, reason: "Competition has ended" };
  }

  // Check if player is already a participant
  const existingParticipant = await prisma.competitionParticipant.findUnique({
    where: {
      competitionId_playerId: {
        competitionId,
        playerId,
      },
    },
  });

  if (existingParticipant) {
    return match(existingParticipant.status)
      .with("JOINED", () => ({ canJoin: false, reason: "Already joined" }))
      .with("INVITED", () => ({ canJoin: false, reason: "Already invited (use accept instead)" }))
      .with("LEFT", () => ({ canJoin: false, reason: "Cannot rejoin after leaving" }))
      .exhaustive();
  }

  // Check participant limit
  const activeParticipantCount = await prisma.competitionParticipant.count({
    where: {
      competitionId,
      status: { not: "LEFT" },
    },
  });

  if (activeParticipantCount >= competition.maxParticipants) {
    return {
      canJoin: false,
      reason: `Competition has reached maximum participants (${competition.maxParticipants.toString()})`,
    };
  }

  return { canJoin: true };
}
