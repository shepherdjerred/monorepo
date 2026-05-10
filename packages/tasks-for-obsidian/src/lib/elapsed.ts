export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  if (hours > 0) {
    return `${String(hours)}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function elapsedSecondsSince(
  startTime: string,
  now: number = Date.now(),
): number {
  const startMs = new Date(startTime).getTime();
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((now - startMs) / 1000));
}
