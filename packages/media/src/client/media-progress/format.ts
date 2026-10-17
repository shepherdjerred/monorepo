/** Never round an incomplete download up to a completed one. */
export function downloadPercent(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw new Error("Invalid download progress");
  return `${String(Math.floor(fraction * 100))}%`;
}

/** This duration is observed seeded time, not time since the torrent was added. */
export function seededDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("Invalid seeding duration");
  if (seconds === 0) return "0 min";
  if (seconds < 60) return "Less than a minute";
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  const parts = [
    ...(days === 0 ? [] : [`${String(days)} ${days === 1 ? "day" : "days"}`]),
    ...(hours === 0
      ? []
      : [`${String(hours)} ${hours === 1 ? "hour" : "hours"}`]),
    ...(remainder === 0 || days > 0 ? [] : [`${String(remainder)} min`]),
  ];
  return parts.join(" ");
}
