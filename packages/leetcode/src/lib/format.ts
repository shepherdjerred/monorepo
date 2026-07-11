export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${String(m)}m${String(rs)}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${String(h)}h${String(rm)}m`;
}

export function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
