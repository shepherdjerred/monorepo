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
  if (input.cancelled) return "Cancelled";
  const startMs = clashEpochMs(input.startTime);
  const registrationMs = clashEpochMs(input.registrationTime);
  if (startMs > 0 && input.now >= startMs) return "Started";
  if (registrationMs > 0 && input.now >= registrationMs) {
    return "Registration open";
  }
  return "Upcoming";
}

export function formatClashIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
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

export function sightingOutcomeLabel(
  outcome: "lobby" | "win" | "loss",
): string {
  if (outcome === "lobby") {
    return "Lobby only";
  }
  if (outcome === "win") {
    return "Win · scored through Feb 2026";
  }
  return "Loss · scored through Feb 2026";
}

export function clashTeamLabel(input: {
  teamAbbreviation?: string | undefined;
  teamName?: string | undefined;
}): string | undefined {
  if (input.teamAbbreviation !== undefined && input.teamName !== undefined) {
    return `${input.teamAbbreviation} · ${input.teamName}`;
  }
  if (input.teamAbbreviation !== undefined) {
    return input.teamAbbreviation;
  }
  return input.teamName;
}
