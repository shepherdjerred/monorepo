import type { TorrentObservation } from "#integrations/qbittorrent.ts";

export function seedingObservation(
  observed: Pick<
    TorrentObservation,
    "ratio" | "seeding_time" | "size" | "progress"
  >,
  owned: boolean,
) {
  return {
    ratio:
      observed.ratio.kind === "finite" ? observed.ratio.value : observed.ratio,
    seedingSeconds: observed.seeding_time,
    sizeBytes: observed.size,
    complete: observed.progress === 1,
    owned,
    dependenciesRemaining: false,
  };
}
