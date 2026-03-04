export type TimeRange = {
  from: number;
  to: number;
};

const DURATION_REGEX = /^(\d+)([smhdw])$/;

const MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseDuration(input: string): number | null {
  const match = DURATION_REGEX.exec(input);
  if (match == null) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2];
  if (unit == null) {
    return null;
  }

  const multiplier = MULTIPLIERS[unit];

  return multiplier == null ? null : value * multiplier;
}

function parseTimestamp(input: string): number {
  const asNumber = Number(input);

  // Try epoch milliseconds
  if (!Number.isNaN(asNumber) && asNumber > 1_000_000_000_000) {
    return asNumber;
  }

  // Try epoch seconds
  if (!Number.isNaN(asNumber) && asNumber > 1_000_000_000) {
    return asNumber * 1000;
  }

  // Try ISO timestamp
  const date = new Date(input);
  if (!Number.isNaN(date.getTime())) {
    return date.getTime();
  }

  throw new Error(`Cannot parse timestamp: ${input}`);
}

export function parseTimeRange(from?: string, to?: string): TimeRange {
  const now = Date.now();

  let fromMs: number;
  if (from == null) {
    fromMs = now - 3_600_000; // default: 1 hour ago
  } else {
    const duration = parseDuration(from);
    fromMs = duration == null ? parseTimestamp(from) : now - duration;
  }

  let toMs: number;
  if (to == null) {
    toMs = now;
  } else {
    const duration = parseDuration(to);
    toMs = duration == null ? parseTimestamp(to) : now - duration;
  }

  return { from: fromMs, to: toMs };
}
