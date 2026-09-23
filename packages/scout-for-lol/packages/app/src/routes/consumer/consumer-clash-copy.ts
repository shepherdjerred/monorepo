function clashEpochMs(epoch: number): number {
  return epoch < 1_000_000_000_000 && epoch > 0 ? epoch * 1000 : epoch;
}

export function titleCaseToken(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatClashInstant(epoch: number): string {
  const date = new Date(clashEpochMs(epoch));
  if (epoch === 0 || Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function phaseLabel(input: {
  cancelled: boolean;
  registrationTime: number;
  startTime: number;
  now: number;
}): string {
  const startMs = clashEpochMs(input.startTime);
  const registrationMs = clashEpochMs(input.registrationTime);
  return input.cancelled
    ? "Cancelled"
    : startMs > 0 && input.now >= startMs
      ? "Started"
      : registrationMs > 0 && input.now >= registrationMs
        ? "Registration open"
        : "Upcoming";
}

export function formatClashIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export function sightingOutcomeLabel(
  outcome: "lobby" | "win" | "loss",
): string {
  return outcome === "lobby"
    ? "Lobby only"
    : outcome === "win"
      ? "Win · scored through Feb 2026"
      : "Loss · scored through Feb 2026";
}

export function clashTeamLabel(input: {
  teamAbbreviation?: string | undefined;
  teamName?: string | undefined;
}): string | undefined {
  return input.teamAbbreviation !== undefined && input.teamName !== undefined
    ? `${input.teamAbbreviation} · ${input.teamName}`
    : (input.teamAbbreviation ?? input.teamName);
}
