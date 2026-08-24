/**
 * Parse a user-supplied timestamp into whole seconds. Accepts plain seconds (`"90"`), `mm:ss`
 * (`"1:30"`), or `hh:mm:ss` (`"1:02:03"`). Returns `null` for anything malformed — non-numeric
 * fields, more than three groups, or out-of-range sub-minute/second fields (>= 60 in colon form).
 */
function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function parseTimecode(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(":");
  if (parts.length > 3) return null;

  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number.parseInt(part, 10));
  }

  // In colon notation the trailing minute/second fields are two-digit and must be < 60; this
  // catches typos like "1:90". Plain seconds ("90") are unrestricted.
  if (nums.length >= 2 && nums.slice(1).some((n) => n >= 60)) return null;

  return nums.reduce((total, n) => total * 60 + n, 0);
}

/** Format whole seconds back into `m:ss` (or `h:mm:ss` past an hour) for acks. */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0
    ? `${h.toString()}:${pad(m)}:${pad(s)}`
    : `${m.toString()}:${pad(s)}`;
}
