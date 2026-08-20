import type { CustomNightSnapshot } from "@scout-for-lol/data";

export function newestCustomSnapshot(
  current: CustomNightSnapshot | null | undefined,
  candidate: CustomNightSnapshot | null,
  currentAtRequest?: CustomNightSnapshot | null,
): CustomNightSnapshot | null {
  if (currentAtRequest !== undefined && current !== currentAtRequest) {
    if (
      current !== null &&
      current !== undefined &&
      candidate !== null &&
      candidate.id === current.id &&
      candidate.revision > current.revision
    )
      return candidate;
    return current ?? null;
  }
  if (candidate === null) {
    return null;
  }
  if (current?.id === undefined) return candidate;
  return current.id !== candidate.id || candidate.revision > current.revision
    ? candidate
    : current;
}
