import type {
  CustomGameParticipant,
  CustomNightSnapshot,
  CustomRole,
} from "@scout-for-lol/data";

export function customRoleFor(
  snapshot: CustomNightSnapshot,
  discordId: string,
  administrator: boolean,
): CustomRole {
  if (administrator) return "ADMIN";
  if (snapshot.hostDiscordId === discordId) return "HOST";
  if (snapshot.cohostDiscordIds.includes(discordId)) return "COHOST";
  const participant = snapshot.participants.find(
    (candidate) => candidate.discordId === discordId,
  );
  return participant?.role === "CAPTAIN" ? "CAPTAIN" : "MEMBER";
}

export function canManageCustomNight(role: CustomRole): boolean {
  return role === "HOST" || role === "COHOST" || role === "ADMIN";
}

export function canDraftForTeam(
  role: CustomRole,
  actorDiscordId: string,
  participants: readonly CustomGameParticipant[],
  activeTeam: "A" | "B",
): boolean {
  return (
    canManageCustomNight(role) ||
    participants.some(
      (participant) =>
        participant.discordId === actorDiscordId &&
        participant.captain &&
        participant.team === activeTeam,
    )
  );
}
