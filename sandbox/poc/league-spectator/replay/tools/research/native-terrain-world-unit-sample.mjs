import { latestAt, samplePath } from "./native-terrain-motion-sample.mjs";

/** Seek-independent samples limited to observed anchors and bounded paths. */
export function sampleNativeTerrainWorldUnits(
  instances,
  timeSeconds,
  groundHeight,
) {
  /** @type {{ participantId: number, position: [number, number, number], context?: number, teamId?: 100 | 200 }[]} */
  const units = [];
  for (const unit of instances) {
    if (
      timeSeconds < unit.creationTimeSeconds ||
      (unit.killTimeSeconds !== null && timeSeconds >= unit.killTimeSeconds)
    )
      continue;
    const path = latestAt(unit.paths, timeSeconds);
    if (path === undefined || timeSeconds > path.endTimeSeconds) continue;
    const { x, z } = samplePath(path, timeSeconds);
    const y = groundHeight(x, z);
    if (y === null) throw Error("Recorded world unit lies outside Map11");
    units.push({
      participantId: unit.participantId,
      position: [x, y, z],
      ...(unit.context === undefined ? {} : { context: unit.context }),
      ...(unit.teamId === undefined ? {} : { teamId: unit.teamId }),
    });
  }
  return units;
}
