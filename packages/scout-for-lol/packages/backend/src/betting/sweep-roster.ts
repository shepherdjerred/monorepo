import type { BucksPoolParticipant } from "@scout-for-lol/data";

export function aliasesForTeam(
  roster: readonly BucksPoolParticipant[],
  teamId: number,
): string[] {
  return roster
    .filter((participant) => participant.teamId === teamId)
    .map((participant) => participant.trackedAlias)
    .filter((alias) => alias !== undefined);
}

export function subjectAlias(
  roster: readonly BucksPoolParticipant[],
  subjectPuuid: string,
): string {
  const subject = roster.find(
    (participant) => participant.puuid === subjectPuuid,
  );
  return subject?.trackedAlias ?? "a tracked player";
}
