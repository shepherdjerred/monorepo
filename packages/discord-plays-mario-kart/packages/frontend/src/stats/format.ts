/** "1:23.45" — MK64 race clocks run in hundredths. */
export function formatRaceTime(ms: number): string {
  const totalHundredths = Math.round(ms / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/** "1st", "2nd", "3rd", "4th" … "8th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) {
    return `${String(n)}th`;
  }
  switch (n % 10) {
    case 1: {
      return `${String(n)}st`;
    }
    case 2: {
      return `${String(n)}nd`;
    }
    case 3: {
      return `${String(n)}rd`;
    }
    default: {
      return `${String(n)}th`;
    }
  }
}

/** "just now", "5m ago", "3h ago", "2d ago", else a short date. */
export function relativeTime(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${String(days)}d ago`;
  }
  return new Date(thenMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function percent(fraction: number): string {
  return `${String(Math.round(fraction * 100))}%`;
}

export function averagePlace(value: number): string {
  return value.toFixed(1);
}

export const GAME_MODE_LABELS = {
  gp: "Grand Prix",
  versus: "VS",
  "time-trials": "Time Trials",
} as const;
