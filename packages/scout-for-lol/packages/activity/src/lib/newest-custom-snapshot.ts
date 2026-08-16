import type { CustomNightSnapshot } from "@scout-for-lol/data";

export function newestCustomSnapshot(
  current: CustomNightSnapshot | null | undefined,
  candidate: CustomNightSnapshot,
): CustomNightSnapshot {
  return current === undefined ||
    current === null ||
    candidate.revision > current.revision
    ? candidate
    : current;
}
