import type { CompletedMatch } from "@scout-for-lol/data";

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString()}min ${s.toString()}s`;
}

export function queueLabel(queueType: CompletedMatch["queueType"]): string {
  if (queueType === "flex") return "RANKED FLEX";
  return "RANKED SOLO";
}

export function winningTeamOf(
  player: CompletedMatch["players"][number],
): "blue" | "red" {
  const isWin = player.outcome === "Victory";
  if (isWin) return player.team;
  return player.team === "blue" ? "red" : "blue";
}
