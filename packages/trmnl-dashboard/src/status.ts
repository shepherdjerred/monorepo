export type Status = "ok" | "warning" | "error" | "unknown";

const rank: Record<Status, number> = {
  ok: 0,
  unknown: 1,
  warning: 2,
  error: 3,
};

export function worstStatus(statuses: readonly Status[]): Status {
  return statuses.length === 0
    ? "unknown"
    : statuses.reduce((worst, status) =>
        rank[status] > rank[worst] ? status : worst,
      );
}

export function statusFromCount(
  count: number,
  warningThreshold: number,
  errorThreshold: number,
): Status {
  if (count >= errorThreshold) {
    return "error";
  }
  return count >= warningThreshold ? "warning" : "ok";
}

export function isUnavailableState(state: string): boolean {
  return state === "unavailable" || state === "unknown";
}
