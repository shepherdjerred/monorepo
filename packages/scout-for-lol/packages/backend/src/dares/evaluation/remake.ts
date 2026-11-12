import type { CanonicalMatch } from "@scout-for-lol/data";
export function isRemakeMatch(matchData: CanonicalMatch): boolean {
  return (
    matchData.info.endOfGameResult !== "GameComplete" ||
    matchData.info.participants.some(
      (participant) =>
        participant.gameEndedInEarlySurrender ||
        participant.teamEarlySurrendered,
    )
  );
}
