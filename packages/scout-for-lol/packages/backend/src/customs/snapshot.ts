import {
  CustomNightSnapshotSchema,
  type CustomGameSnapshot,
  type CustomNightParticipant,
  type CustomNightSnapshot,
  type CustomRecruitmentCounts,
} from "@scout-for-lol/data";

export const CUSTOM_NIGHT_TTL_MS = 12 * 60 * 60 * 1000;
export const CUSTOM_DISCLOSURE_VERSION = "2026-08-15";
const TOURNAMENT_PROVISIONING_STALE_MS = 5 * 60_000;
const VOICE_ARRANGEMENT_STALE_MS = 5 * 60_000;

export function hasActiveTournamentCodeProvisioning(
  game: CustomGameSnapshot | null,
  now: Date,
): boolean {
  const provisioning = game?.tournamentCodeProvisioning;
  if (provisioning === undefined || provisioning === null) return false;
  return (
    now.getTime() - new Date(provisioning.startedAt).getTime() <
    TOURNAMENT_PROVISIONING_STALE_MS
  );
}

export function hasActiveVoiceArrangementProvisioning(
  game: CustomGameSnapshot | null,
  now: Date,
): boolean {
  const provisioning = game?.voiceArrangementProvisioning;
  if (provisioning === undefined || provisioning === null) return false;
  return (
    now.getTime() - new Date(provisioning.startedAt).getTime() <
    VOICE_ARRANGEMENT_STALE_MS
  );
}

export function shouldExpireCustomNight(
  snapshot: { state: string; expiresAt: string },
  now: Date,
): boolean {
  return (
    snapshot.state !== "ENDED" &&
    new Date(snapshot.expiresAt).getTime() <= now.getTime()
  );
}

export function recruitmentCounts(
  participants: readonly CustomNightParticipant[],
): CustomRecruitmentCounts {
  const away = participants.filter(
    (participant) => participant.awayUntil !== null || participant.awayOverdue,
  ).length;
  const held = participants.filter((participant) => participant.held).length;
  const ready = participants.filter(
    (participant) =>
      participant.availability === "READY" &&
      participant.awayUntil === null &&
      !participant.awayOverdue,
  ).length;
  const eligible = participants.filter(
    (participant) =>
      participant.held ||
      (participant.availability === "READY" &&
        participant.awayUntil === null &&
        !participant.awayOverdue),
  ).length;
  return {
    ready,
    maybe: participants.filter(
      (participant) => participant.availability === "MAYBE",
    ).length,
    away,
    held,
    remaining: Math.max(0, 10 - eligible),
  };
}

export function refreshSnapshot(
  snapshot: CustomNightSnapshot,
  now: Date,
): CustomNightSnapshot {
  const lastActivityAt = now.toISOString();
  return CustomNightSnapshotSchema.parse({
    ...snapshot,
    recruitmentCounts: recruitmentCounts(snapshot.participants),
    lastActivityAt,
    expiresAt: new Date(now.getTime() + CUSTOM_NIGHT_TTL_MS).toISOString(),
  });
}

export function markOverdueAway(
  snapshot: CustomNightSnapshot,
  now: Date,
): CustomNightSnapshot {
  const participants = snapshot.participants.map((participant) => {
    if (
      participant.awayUntil !== null &&
      new Date(participant.awayUntil).getTime() <= now.getTime()
    ) {
      return { ...participant, awayOverdue: true };
    }
    return participant;
  });
  return CustomNightSnapshotSchema.parse({
    ...snapshot,
    participants,
    recruitmentCounts: recruitmentCounts(participants),
  });
}

export function parseCustomNightSnapshot(raw: string): CustomNightSnapshot {
  return CustomNightSnapshotSchema.parse(JSON.parse(raw));
}
