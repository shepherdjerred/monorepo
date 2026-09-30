export function formatClashThemeLabel(
  nameKey: string,
  nameKeySecondary: string,
): string {
  return `${titleCaseKey(nameKey)} · ${titleCaseKey(nameKeySecondary)}`;
}

function titleCaseKey(value: string): string {
  return value
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function toClashEpochMs(value: number): number {
  return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
}

export function isClashPlayerPollWindow(
  schedule: readonly {
    registrationTime: number;
    startTime: number;
    cancelled: boolean;
  }[],
  nowMs: number,
): boolean {
  return schedule.some((phase) => {
    if (phase.cancelled) {
      return false;
    }
    const start = toClashEpochMs(phase.startTime);
    if (start === 0) {
      return false;
    }
    const registration = toClashEpochMs(phase.registrationTime);
    return (
      !(registration > 0 && nowMs + WEEK_MS < registration) &&
      nowMs <= start + WEEK_MS
    );
  });
}

export function clashScheduleSightingWindow(
  schedule: readonly {
    registrationTime: number;
    startTime: number;
    cancelled: boolean;
  }[],
): { startMs: number; endMs: number } | undefined {
  let startMs: number | undefined;
  let endMs: number | undefined;
  for (const phase of schedule) {
    if (phase.cancelled) {
      continue;
    }
    const start = toClashEpochMs(phase.startTime);
    if (start === 0) {
      continue;
    }
    const registration = toClashEpochMs(phase.registrationTime);
    const windowStart = registration > 0 ? registration : start;
    const windowEnd = start + WEEK_MS;
    startMs =
      startMs === undefined ? windowStart : Math.min(startMs, windowStart);
    endMs = endMs === undefined ? windowEnd : Math.max(endMs, windowEnd);
  }
  return startMs === undefined || endMs === undefined
    ? undefined
    : { startMs, endMs };
}
