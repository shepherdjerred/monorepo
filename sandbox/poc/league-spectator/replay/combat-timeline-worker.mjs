import { decompress } from "/assets/vendor/fzstd.mjs";
import {
  decodeReplayObservations,
  createReplayObservationKdaTimeline,
} from "@scout-for-lol/replay/observations";

// Local research host only. The reusable decoder owns no fetch or worker globals.
try {
  const response = await fetch("/research-latest.rofl");
  if (!response.ok) throw Error("No local research replay was supplied.");
  const observations = decodeReplayObservations(
    await response.arrayBuffer(),
    decompress,
    {
      lifecycle: new URL(self.location.href).searchParams.has("levels"),
    },
  );
  const {
    build,
    duration,
    roster,
    binding,
    returns,
    turrets,
    structures,
    aliveCounts,
  } = observations;
  const levels = observations.levels?.events ?? null;
  const championByContext = new Map(
    binding.verified.map(({ context, footerRow }) => [
      context,
      roster[footerRow - 1].champion,
    ]),
  );
  self.postMessage({
    build,
    duration,
    events: binding.events.map(({ kind, partition, timeSeconds, context }) => ({
      kind,
      partition,
      timeSeconds,
      champion: championByContext.get(context) ?? null,
    })),
    kdaTimeline: createReplayObservationKdaTimeline(observations),
    ...(levels === null
      ? {}
      : {
          aliveCounts,
          turrets:
            turrets?.map(({ timeSeconds, defendingPartition }) => ({
              timeSeconds,
              defendingPartition,
            })) ?? null,
          inhibitors:
            structures
              ?.filter(({ kind }) => kind === "inhibitor-destruction")
              .map(({ timeSeconds }) => ({ timeSeconds })) ?? null,
          returns:
            returns?.map(({ context, partition, timeSeconds }) => ({
              partition,
              timeSeconds,
              champion: championByContext.get(context) ?? null,
            })) ?? null,
          levels: levels.map(({ context, footerRow, level, timeSeconds }) => ({
            partition: footerRow === null ? null : footerRow <= 5 ? 0 : 1,
            champion: championByContext.get(context) ?? null,
            level,
            timeSeconds,
          })),
        }),
  });
} catch (error) {
  self.postMessage({ error: error.message });
}
