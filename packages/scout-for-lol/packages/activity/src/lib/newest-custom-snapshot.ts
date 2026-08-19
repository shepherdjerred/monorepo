import type { CustomNightSnapshot } from "@scout-for-lol/data";

export function newestCustomSnapshot(
  current: CustomNightSnapshot | null | undefined,
  candidate: CustomNightSnapshot | null,
): CustomNightSnapshot | null {
  if (candidate === null) {
    return current?.state === "ENDED" ? null : (current ?? null);
  }
  if (current?.id === undefined) return candidate;
  return current.id !== candidate.id || candidate.revision > current.revision
    ? candidate
    : current;
}
